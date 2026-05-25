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

/** Bulk import contact rows. Creates an import_batches row and tags every
 * contact with its id, so the Approve queue can filter by batch later.
 * Returns the contact_ids of every successfully inserted/updated contact. */
export async function bulkImportContacts(
  rows: AddContactInput[],
  batch_label?: string,
  opts: { file_name?: string } = {}
) {
  let imported = 0, updated = 0, failed = 0;
  const sampleErrors: string[] = [];
  const contactIds: string[] = [];

  // Create the batch up front. Label defaults to "CSV · 2026-05-25 14:32"
  // if caller didn't provide one.
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const batchName = batch_label?.trim() || `CSV · ${stamp}`;
  let batchId: string | undefined;
  try {
    batchId = await createImportBatch({
      name: batchName, source: "csv", file_name: opts.file_name,
    });
  } catch (e) {
    // Non-fatal — fall back to a null batch so import still works
    console.warn("createImportBatch failed, proceeding without batch tag:", e);
  }

  for (const r of rows) {
    if (!r.email || !r.first_name) {
      failed++;
      if (sampleErrors.length < 5) sampleErrors.push(`Missing name/email: ${r.email ?? "?"}`);
      continue;
    }
    const result = await addContact(
      { ...r, batch_label, source: "csv-upload", import_batch_id: batchId },
      { skipRevalidate: true }
    );
    if (result.ok) {
      contactIds.push(result.contact_id);
      if (result.was_existing) updated++; else imported++;
    } else {
      failed++;
      if (sampleErrors.length < 5) sampleErrors.push(`${r.email}: ${result.error}`);
    }
  }
  revalidatePath("/contacts");
  revalidatePath("/approve");
  revalidatePath("/");
  return { ok: true, imported, updated, failed, sample_errors: sampleErrors, contact_ids: contactIds, batch_id: batchId };
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
