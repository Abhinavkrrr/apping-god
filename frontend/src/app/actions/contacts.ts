"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

interface AddContactInput {
  first_name: string;
  last_name?: string;
  email: string;
  company_name?: string;
  company_brief?: string;
  title?: string;
  linkedin_url?: string;
  phone?: string;             // stored in contacts.custom_fields.phone (no schema change)
  batch_label?: string;       // legacy; stored in custom_fields for compatibility
  import_batch_id?: string;   // NEW: FK into import_batches table
  source?: string;            // e.g. "manual" | "csv-upload" | "quick-add"
}

/** Create an import_batches row; returns its id. */
export async function createImportBatch(input: {
  name: string;
  source: "csv" | "discover" | "quick_add" | "manual";
  file_name?: string;
  notes?: string;
}): Promise<string> {
  const sb = createAdminClient();
  const { data, error } = await sb.from("import_batches").insert({
    name: input.name,
    source: input.source,
    file_name: input.file_name ?? null,
    notes: input.notes ?? null,
  }).select("id").single();
  if (error) throw new Error(`createImportBatch: ${error.message}`);
  return data.id;
}

export async function addContact(input: AddContactInput, opts: { skipRevalidate?: boolean } = {}) {
  const sb = createAdminClient();

  // BLOCK re-imports of previously-bounced / unsubscribed emails. The
  // unsubscribes table is the canonical "do not contact" list — populated
  // by the bounce flow (poll_replies + dashboard migrate) AND by user
  // manual unsubscribes. Refuse to add a contact with such an email.
  const earlyEmail = (input.email ?? "").toLowerCase().trim();
  if (earlyEmail && earlyEmail.includes("@")) {
    const { data: blocked } = await sb.from("unsubscribes")
      .select("email, reason").eq("email", earlyEmail).maybeSingle();
    if (blocked) {
      return {
        ok: false as const,
        error: `${input.email} is blocked (${blocked.reason ?? "unsubscribed/bounced"}) — refusing to add`,
      };
    }
  }

  // Resolve company by case-insensitive name
  let company_id: string | null = null;
  if (input.company_name?.trim()) {
    const name = input.company_name.trim();
    const { data: existingCo } = await sb.from("companies").select("id")
      .ilike("name", name).maybeSingle();
    if (existingCo) {
      company_id = existingCo.id;
      if (input.company_brief) {
        await sb.from("companies").update({ brief_one_line: input.company_brief }).eq("id", company_id);
      }
    } else {
      const { data: created, error: ce } = await sb.from("companies").insert({
        name, brief_one_line: input.company_brief ?? null,
      }).select("id").single();
      if (ce) return { ok: false as const, error: `company: ${ce.message}` };
      company_id = created.id;
    }
  }

  const email = input.email.toLowerCase().trim();
  const custom_fields: Record<string, unknown> = {};
  if (input.batch_label) custom_fields.batch_label = input.batch_label;
  // Phone goes into custom_fields (contacts table doesn't have a dedicated
  // phone column yet — putting it here avoids a schema migration). Surfaces
  // in /contacts row drawer via custom_fields.phone access.
  if (input.phone?.trim()) custom_fields.phone = input.phone.trim();

  // Check if contact already exists by email (UNIQUE)
  const { data: existing } = await sb.from("contacts").select("id, custom_fields")
    .eq("email", email).maybeSingle();

  if (existing) {
    // Update what makes sense — name/title/linkedin/company, merge custom_fields
    const mergedCustom = {
      ...((existing.custom_fields as Record<string, unknown>) ?? {}),
      ...custom_fields,
    };
    const { error: uErr } = await sb.from("contacts").update({
      first_name: input.first_name.trim(),
      last_name: input.last_name?.trim() || null,
      ...(company_id ? { company_id } : {}),
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
      ...(input.linkedin_url?.trim() ? { linkedin_url: input.linkedin_url.trim() } : {}),
      // Don't clobber import_batch_id on an existing contact — they were
      // first imported via some other batch; we keep that history.
      custom_fields: Object.keys(mergedCustom).length > 0 ? mergedCustom : null,
    }).eq("id", existing.id);
    if (uErr) return { ok: false as const, error: uErr.message };
    if (!opts.skipRevalidate) { revalidatePath("/contacts"); revalidatePath("/"); }
    return { ok: true as const, contact_id: existing.id, was_existing: true };
  }

  const { data: contact, error } = await sb.from("contacts").insert({
    first_name: input.first_name.trim(),
    last_name: input.last_name?.trim() || null,
    email,
    company_id,
    title: input.title?.trim() || null,
    linkedin_url: input.linkedin_url?.trim() || null,
    source: input.source ?? "manual",
    import_batch_id: input.import_batch_id ?? null,
    custom_fields: Object.keys(custom_fields).length > 0 ? custom_fields : null,
  }).select("id").single();
  if (error) return { ok: false as const, error: error.message };
  if (!opts.skipRevalidate) { revalidatePath("/contacts"); revalidatePath("/"); }
  return { ok: true as const, contact_id: contact.id, was_existing: false };
}

/** Bulk import contact rows. Batched — does ~5 round-trips total across all
 * rows instead of ~5 per row. Pattern:
 *   1. Pre-validate (skip missing email/name rows)
 *   2. Bulk-check unsubscribes (single .in() query for all emails)
 *   3. Bulk-resolve company_id (single ilike .or() across all unique companies,
 *      then one INSERT for new ones)
 *   4. Bulk-check existing contacts by email (single .in() query)
 *   5. Bulk INSERT new contacts (one round-trip)
 *   6. Pool-of-10 parallel UPDATE for existing contacts (can't batch UPDATEs
 *      cleanly when each row needs unique values)
 *
 * Result: 405 contacts goes from ~10 min sequential → ~3-5 seconds batched. */
export async function bulkImportContacts(
  rows: AddContactInput[],
  batch_label?: string,
  opts: { file_name?: string } = {}
) {
  const sb = createAdminClient();
  const sampleErrors: string[] = [];

  // ── Phase 0: Filter out structurally-invalid rows ─────────────
  type Normalized = AddContactInput & { email: string; first_name: string };
  const valid: Normalized[] = [];
  let failedMissing = 0;
  for (const r of rows) {
    if (!r.email || !r.first_name) {
      failedMissing++;
      if (sampleErrors.length < 5) sampleErrors.push(`Missing name/email: ${r.email ?? "?"}`);
      continue;
    }
    valid.push({ ...r, email: r.email.toLowerCase().trim(), first_name: r.first_name.trim() });
  }

  // Create the import_batches row up front so every row gets tagged.
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const batchName = batch_label?.trim() || `CSV · ${stamp}`;
  let batchId: string | undefined;
  try {
    batchId = await createImportBatch({
      name: batchName, source: "csv", file_name: opts.file_name,
    });
  } catch (e) {
    console.warn("createImportBatch failed, proceeding without batch tag:", e);
  }

  if (valid.length === 0) {
    return {
      ok: true, imported: 0, updated: 0, failed: failedMissing,
      sample_errors: sampleErrors, contact_ids: [], batch_id: batchId,
    };
  }

  // ── Phase 1: bulk-check unsubscribes ──────────────────────────
  const allEmails = [...new Set(valid.map(r => r.email))];
  const { data: unsubsData } = await sb.from("unsubscribes")
    .select("email").in("email", allEmails);
  const blockedEmails = new Set((unsubsData ?? []).map((u: any) => u.email));

  // Partition: drop blocked rows up-front so we don't waste any further work
  let blockedCount = 0;
  const toProcess = valid.filter(r => {
    if (blockedEmails.has(r.email)) {
      blockedCount++;
      if (sampleErrors.length < 5) sampleErrors.push(`${r.email}: blocked (previously bounced / unsubscribed)`);
      return false;
    }
    return true;
  });

  if (toProcess.length === 0) {
    return {
      ok: true, imported: 0, updated: 0, failed: failedMissing + blockedCount,
      sample_errors: sampleErrors, contact_ids: [], batch_id: batchId,
    };
  }

  // ── Phase 2: bulk-resolve company_id for every unique company ─
  const uniqueCompanyNames = [...new Set(
    toProcess.map(r => r.company_name?.trim()).filter(Boolean) as string[]
  )];
  const companyMap = new Map<string, string>();   // lowercased name → company.id

  if (uniqueCompanyNames.length > 0) {
    // Case-insensitive lookup via .or() with ilike per name. For 50-200
    // unique companies this fits comfortably in the URL length limit.
    // For larger imports the OR-chain would need chunking.
    const orClause = uniqueCompanyNames
      .map(n => `name.ilike.${n.replace(/[,()]/g, "")}`)
      .join(",");
    const { data: existingCos } = await sb.from("companies")
      .select("id, name").or(orClause);
    for (const co of (existingCos ?? []) as any[]) {
      companyMap.set(co.name.toLowerCase().trim(), co.id);
    }

    // Insert companies that didn't exist (one batch INSERT)
    const missing = uniqueCompanyNames.filter(n => !companyMap.has(n.toLowerCase().trim()));
    if (missing.length > 0) {
      const inserts = missing.map(name => {
        const r = toProcess.find(x => x.company_name?.trim() === name && x.company_brief);
        return { name, brief_one_line: r?.company_brief ?? null };
      });
      const { data: created } = await sb.from("companies")
        .insert(inserts).select("id, name");
      for (const co of (created ?? []) as any[]) {
        companyMap.set(co.name.toLowerCase().trim(), co.id);
      }
    }
  }

  // ── Phase 3: bulk-check which contacts already exist ──────────
  const processEmails = toProcess.map(r => r.email);
  const { data: existingContacts } = await sb.from("contacts")
    .select("id, email, custom_fields").in("email", processEmails);
  const existingMap = new Map<string, { id: string; custom_fields: any }>();
  for (const c of (existingContacts ?? []) as any[]) {
    existingMap.set(c.email, { id: c.id, custom_fields: c.custom_fields });
  }

  // ── Phase 4: partition into new (bulk INSERT) vs existing (UPDATE) ──
  const toInsert: any[] = [];
  const toUpdate: Array<{ id: string; patch: any }> = [];
  for (const r of toProcess) {
    const company_id = r.company_name?.trim()
      ? companyMap.get(r.company_name.toLowerCase().trim()) ?? null
      : null;

    const custom_fields: Record<string, unknown> = {};
    if (r.batch_label) custom_fields.batch_label = r.batch_label;
    if (r.phone?.trim()) custom_fields.phone = r.phone.trim();

    const existing = existingMap.get(r.email);
    if (existing) {
      const mergedCustom = {
        ...((existing.custom_fields as Record<string, unknown>) ?? {}),
        ...custom_fields,
      };
      toUpdate.push({
        id: existing.id,
        patch: {
          first_name: r.first_name,
          last_name: r.last_name?.trim() || null,
          ...(company_id ? { company_id } : {}),
          ...(r.title?.trim() ? { title: r.title.trim() } : {}),
          ...(r.linkedin_url?.trim() ? { linkedin_url: r.linkedin_url.trim() } : {}),
          custom_fields: Object.keys(mergedCustom).length > 0 ? mergedCustom : null,
        },
      });
    } else {
      toInsert.push({
        first_name: r.first_name,
        last_name: r.last_name?.trim() || null,
        email: r.email,
        company_id,
        title: r.title?.trim() || null,
        linkedin_url: r.linkedin_url?.trim() || null,
        source: r.source ?? "csv-upload",
        import_batch_id: batchId ?? null,
        custom_fields: Object.keys(custom_fields).length > 0 ? custom_fields : null,
      });
    }
  }

  // ── Phase 5: bulk INSERT new contacts ─────────────────────────
  const contactIds: string[] = [];
  let imported = 0, updated = 0;
  let failed = failedMissing + blockedCount;

  if (toInsert.length > 0) {
    const { data: insertedRows, error: insErr } = await sb.from("contacts")
      .insert(toInsert).select("id");
    if (insErr) {
      failed += toInsert.length;
      if (sampleErrors.length < 5) sampleErrors.push(`bulk insert: ${insErr.message}`);
    } else {
      imported = insertedRows?.length ?? 0;
      for (const c of (insertedRows ?? []) as any[]) contactIds.push(c.id);
    }
  }

  // ── Phase 6: parallel UPDATE existing contacts (pool of 10) ───
  // UPDATEs can't be batched into one statement (each row needs unique
  // patch), but running them concurrently with a small pool brings ~50
  // updates from 5 sec sequential down to ~500ms.
  if (toUpdate.length > 0) {
    const POOL = 10;
    for (let i = 0; i < toUpdate.length; i += POOL) {
      const batch = toUpdate.slice(i, i + POOL);
      const results = await Promise.all(batch.map(async (u) => {
        const { error } = await sb.from("contacts").update(u.patch).eq("id", u.id);
        return { id: u.id, ok: !error, error };
      }));
      for (const r of results) {
        if (r.ok) { contactIds.push(r.id); updated++; }
        else {
          failed++;
          if (sampleErrors.length < 5) sampleErrors.push(`update ${r.id}: ${r.error?.message ?? "unknown"}`);
        }
      }
    }
  }

  revalidatePath("/contacts");
  revalidatePath("/approve");
  revalidatePath("/");
  return {
    ok: true, imported, updated, failed,
    sample_errors: sampleErrors, contact_ids: contactIds, batch_id: batchId,
  };
}

/** List all import batches (for the Approve queue filter UI). */
export async function listBatches(): Promise<{
  id: string; name: string; source: string; contact_count: number; created_at: string;
}[]> {
  const sb = createAdminClient();
  const { data } = await sb.from("import_batches")
    .select("id, name, source, contact_count, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as any[];
}

/** Preview before delete: returns counts of contacts + their sends so the
 * UI can show "Delete X contacts + their Y drafts/Z sent?" in the confirm. */
export async function previewBatchDelete(batchId: string): Promise<{
  ok: boolean;
  batch_name?: string;
  contacts?: number;
  pending_drafts?: number;
  scheduled?: number;
  sent?: number;
  error?: string;
}> {
  const sb = createAdminClient();
  const { data: batch } = await sb.from("import_batches")
    .select("name").eq("id", batchId).maybeSingle();
  if (!batch) return { ok: false, error: "Batch not found." };

  const { data: contacts } = await sb.from("contacts")
    .select("id").eq("import_batch_id", batchId);
  const contactIds = (contacts ?? []).map((c: any) => c.id);

  if (contactIds.length === 0) {
    return { ok: true, batch_name: batch.name, contacts: 0,
      pending_drafts: 0, scheduled: 0, sent: 0 };
  }

  const { data: sends } = await sb.from("sends")
    .select("status").in("contact_id", contactIds);
  const counts = (sends ?? []).reduce<Record<string, number>>((acc, s: any) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1; return acc;
  }, {});

  return {
    ok: true,
    batch_name: batch.name,
    contacts: contactIds.length,
    pending_drafts: counts["pending_approval"] ?? 0,
    scheduled: counts["approved"] ?? 0,
    sent: counts["sent"] ?? 0,
  };
}

/** Hard-delete an import batch: removes every contact tagged with this
 * batch_id, which cascades to sends → approvals/events/replies, then
 * deletes the import_batches row itself. */
export async function deleteBatch(batchId: string): Promise<{
  ok: boolean; deleted_contacts?: number; error?: string;
}> {
  const sb = createAdminClient();
  const { data: batch } = await sb.from("import_batches")
    .select("name").eq("id", batchId).maybeSingle();
  if (!batch) return { ok: false, error: "Batch not found." };

  // sends → cascade-deletes approvals/events/replies via FK
  // contacts → cascade-deletes sends via FK
  const { data: deleted, error: dErr } = await sb.from("contacts")
    .delete().eq("import_batch_id", batchId).select("id");
  if (dErr) return { ok: false, error: `delete contacts: ${dErr.message}` };

  // Now drop the batch row itself
  const { error: bErr } = await sb.from("import_batches").delete().eq("id", batchId);
  if (bErr) return { ok: false, error: `delete batch: ${bErr.message}` };

  revalidatePath("/contacts");
  revalidatePath("/approve");
  revalidatePath("/scheduled");
  revalidatePath("/");
  return { ok: true, deleted_contacts: deleted?.length ?? 0 };
}

export async function updateContact(
  contactId: string,
  patch: {
    first_name?: string; last_name?: string | null; title?: string | null;
    role_type?: string | null; linkedin_url?: string | null;
    skip_reason?: string | null;
  }
) {
  const sb = createAdminClient();
  const { error } = await sb.from("contacts").update(patch).eq("id", contactId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contacts");
  return { ok: true };
}

export async function deleteContact(contactId: string) {
  const sb = createAdminClient();
  const { error } = await sb.from("contacts").delete().eq("id", contactId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contacts");
  return { ok: true };
}

export async function markUnsubscribed(email: string) {
  const sb = createAdminClient();
  const lower = email.toLowerCase().trim();
  await sb.from("unsubscribes").upsert({ email: lower, reason: "manual" });
  await sb.from("contacts").update({ unsubscribed_at: new Date().toISOString() }).eq("email", lower);
  // Also skip any pending drafts to this address so we don't accidentally
  // send after they've unsubscribed.
  await sb.from("sends").update({ status: "skipped", failure_reason: "unsubscribed" })
    .eq("status", "pending_approval")
    .in("contact_id",
      (await sb.from("contacts").select("id").eq("email", lower)).data?.map((c: any) => c.id) ?? []
    );
  revalidatePath("/contacts");
  revalidatePath("/approve");
  revalidatePath("/");
  return { ok: true };
}
