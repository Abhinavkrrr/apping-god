"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

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
