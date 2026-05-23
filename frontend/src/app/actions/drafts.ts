"use server";

import { createAdminClient } from "@/lib/supabase/admin";

/** Fetches the rendered_subject + rendered_body for a single send.
 * Called lazily by the approval row when the user clicks Preview, so the
 * Approve page initial load doesn't pull ~1KB×N of email body HTML. */
export async function loadDraftBody(sendId: string) {
  const sb = createAdminClient();
  const { data, error } = await sb.from("sends")
    .select("rendered_subject, rendered_body")
    .eq("id", sendId).single();
  if (error || !data) return { ok: false, error: error?.message ?? "not found" };
  return {
    ok: true,
    subject: data.rendered_subject ?? "",
    body: data.rendered_body ?? "",
  };
}
