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
}

export async function addContact(input: AddContactInput) {
  const sb = createAdminClient();

  // Upsert company by name (case-insensitive)
  let company_id: string | null = null;
  if (input.company_name?.trim()) {
    const name = input.company_name.trim();
    const { data: existing } = await sb.from("companies").select("id")
      .ilike("name", name).maybeSingle();
    if (existing) {
      company_id = existing.id;
      if (input.company_brief) {
        await sb.from("companies").update({ brief_one_line: input.company_brief }).eq("id", company_id);
      }
    } else {
      const { data: created, error: ce } = await sb.from("companies").insert({
        name, brief_one_line: input.company_brief ?? null,
      }).select("id").single();
      if (ce) return { ok: false, error: `company: ${ce.message}` };
      company_id = created.id;
    }
  }

  const { error } = await sb.from("contacts").insert({
    first_name: input.first_name.trim(),
    last_name: input.last_name?.trim() || null,
    email: input.email.toLowerCase().trim(),
    company_id,
    title: input.title?.trim() || null,
    linkedin_url: input.linkedin_url?.trim() || null,
    source: "manual",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contacts");
  revalidatePath("/");
  return { ok: true };
}

/** Bulk import an array of contact rows (from dashboard CSV upload). */
export async function bulkImportContacts(rows: AddContactInput[]) {
  let imported = 0, failed = 0;
  for (const r of rows) {
    if (!r.email || !r.first_name) { failed++; continue; }
    const result = await addContact(r);
    if (result.ok) imported++; else failed++;
  }
  revalidatePath("/contacts");
  return { ok: true, imported, failed };
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
  await sb.from("unsubscribes").upsert({ email, reason: "manual" });
  await sb.from("contacts").update({ unsubscribed_at: new Date().toISOString() }).eq("email", email);
  revalidatePath("/contacts");
  return { ok: true };
}
