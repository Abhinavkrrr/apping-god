"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { render, buildContext, plainToTrackedHtml } from "@/lib/send/render";

/** Re-renders every pending_approval draft that uses this template. */
async function rerenderPendingDrafts(templateId: string): Promise<number> {
  const sb = createAdminClient();
  const { data: tpl } = await sb.from("templates")
    .select("subject_tmpl, body_tmpl").eq("id", templateId).single();
  if (!tpl) return 0;

  const { data: drafts } = await sb.from("sends").select(`
    id, contact_id,
    contacts(first_name, last_name, email, title, companies(id, name, domain, brief_one_line))
  `).eq("template_id", templateId).eq("status", "pending_approval");

  if (!drafts || drafts.length === 0) return 0;

  let count = 0;
  for (const d of drafts) {
    const c = (d as any).contacts;
    if (!c) continue;
    const company = c.companies ?? null;
    const ctx = buildContext(c, company, {
      company_brief_one_line: company?.brief_one_line ?? "",
    });
    const subject = render(tpl.subject_tmpl, ctx);
    const text = render(tpl.body_tmpl, ctx);
    const html = plainToTrackedHtml(text, d.id);
    await sb.from("sends").update({
      rendered_subject: subject, rendered_body: html,
    }).eq("id", d.id);
    count++;
  }
  return count;
}

export async function updateTemplate(
  templateId: string,
  patch: { subject_tmpl?: string; body_tmpl?: string; personalization_level?: "light" | "medium" }
) {
  const sb = createAdminClient();
  const { error } = await sb.from("templates").update(patch).eq("id", templateId);
  if (error) return { ok: false, error: error.message };

  // If subject/body changed, re-render every pending draft using this template
  // so the new content shows in Approve queue + Preview immediately.
  let rerendered = 0;
  if (patch.subject_tmpl !== undefined || patch.body_tmpl !== undefined) {
    rerendered = await rerenderPendingDrafts(templateId);
  }

  revalidatePath("/templates");
  revalidatePath("/approve");
  revalidatePath("/");
  return { ok: true, rerendered };
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
  if (!input.subject_tmpl?.trim() || !input.body_tmpl?.trim()) {
    return { ok: false, error: "Subject and body required." };
  }
  const { data, error } = await sb.from("templates").insert(input).select().single();
  if (error) return { ok: false, error: error.message };

  // Wire this template into the campaign's sequence so it actually gets used.
  // First-touch = step 0; follow-ups = step 1/2/3 with delay_days = 2 between.
  const stepNumber = input.is_followup ? (input.followup_step ?? 1) : 0;
  // If a sequence step already exists for this campaign+step, replace its
  // template pointer (overrides the previous template at that step).
  const { data: existingSeq } = await sb.from("sequences").select("id")
    .eq("campaign_id", input.campaign_id).eq("step_number", stepNumber).maybeSingle();
  if (existingSeq) {
    await sb.from("sequences").update({ template_id: data.id }).eq("id", existingSeq.id);
  } else {
    await sb.from("sequences").insert({
      campaign_id: input.campaign_id,
      step_number: stepNumber,
      template_id: data.id,
      delay_days: stepNumber === 0 ? 0 : 2,
    });
  }

  revalidatePath("/templates");
  revalidatePath("/approve");
  return { ok: true, data };
}

export async function deleteTemplate(templateId: string) {
  const sb = createAdminClient();
  const { error } = await sb.from("templates").delete().eq("id", templateId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/templates");
  revalidatePath("/approve");
  revalidatePath("/");
  return { ok: true };
}
