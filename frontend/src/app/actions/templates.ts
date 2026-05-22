"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export async function updateTemplate(
  templateId: string,
  patch: { subject_tmpl?: string; body_tmpl?: string; personalization_level?: "light" | "medium" }
) {
  const sb = createAdminClient();
  const { error } = await sb.from("templates").update(patch).eq("id", templateId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/templates");
  return { ok: true };
}

export async function createTemplate(input: {
  campaign_id: string;
  variant_label: string;
  subject_tmpl: string;
  body_tmpl: string;
  is_followup: boolean;
  followup_step: number | null;
}) {
  const sb = createAdminClient();
  const { data, error } = await sb.from("templates").insert(input).select().single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/templates");
  return { ok: true, data };
}

export async function deleteTemplate(templateId: string) {
  const sb = createAdminClient();
  const { error } = await sb.from("templates").delete().eq("id", templateId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/templates");
  return { ok: true };
}
