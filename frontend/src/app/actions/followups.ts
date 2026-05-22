"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { render, buildContext, plainToTrackedHtml } from "@/lib/send/render";

const FUNCTION_URL = `https://${process.env.NEXT_PUBLIC_SUPABASE_URL!.split("//")[1].split(".")[0]}.functions.supabase.co/send-worker`;

/**
 * Manually send the next follow-up step for an existing sent message.
 * @param parentSendId  the original send (or the last follow-up in the chain)
 */
export async function sendFollowupNow(parentSendId: string) {
  const sb = createAdminClient();

  // Load the parent send + everything we need to thread the reply
  const { data: parent } = await sb.from("sends").select(`
    id, contact_id, campaign_id, sequence_step, thread_id, message_id, resume_id,
    contacts(first_name, last_name, email, title, unsubscribed_at, companies(id, name, brief_one_line, recent_news))
  `).eq("id", parentSendId).single();

  if (!parent) return { ok: false, error: "Parent send not found." };
  const c = (parent as any).contacts;
  if (!c?.email) return { ok: false, error: "Contact missing." };
  if (c.unsubscribed_at) return { ok: false, error: "Contact unsubscribed." };

  // Check no reply already
  const { count: replyCount } = await sb.from("replies")
    .select("id", { count: "exact", head: true }).eq("send_id", parentSendId);
  if ((replyCount ?? 0) > 0) {
    return { ok: false, error: "This thread already has a reply — won't follow up." };
  }

  const nextStep = parent.sequence_step + 1;
  if (nextStep > 3) return { ok: false, error: "All 3 follow-ups already sent." };

  // Get the template for the next step
  const { data: seq } = await sb.from("sequences").select("*, templates(*)")
    .eq("campaign_id", parent.campaign_id).eq("step_number", nextStep).single();
  if (!seq?.templates) return { ok: false, error: `No template for step ${nextStep}.` };
  const tpl = (seq as any).templates;

  // Render
  const sendId = randomUUID();
  const company = c.companies;
  const ctx = buildContext(c, company, { company_brief_one_line: company?.brief_one_line ?? "" });
  const subject = render(tpl.subject_tmpl, ctx);
  const text = render(tpl.body_tmpl, ctx);
  const html = plainToTrackedHtml(text, sendId);

  // Insert new send row, threaded
  const { error: insErr } = await sb.from("sends").insert({
    id: sendId,
    contact_id: parent.contact_id,
    campaign_id: parent.campaign_id,
    sequence_step: nextStep,
    template_id: tpl.id,
    resume_id: null, // follow-ups don't re-attach the resume
    rendered_subject: subject,
    rendered_body: html,
    status: "approved",
    scheduled_at: new Date().toISOString(),
    thread_id: parent.thread_id ?? parent.message_id,
  });
  if (insErr) return { ok: false, error: insErr.message };

  // Dispatch via Edge Function (threaded)
  try {
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: c.email,
        subject,
        text_body: text,
        html_body: html,
        log_send_id: sendId,
        in_reply_to: parent.message_id,
        references: parent.message_id,
      }),
    });
    const out = await res.json();
    if (!res.ok || !out.ok) {
      await sb.from("sends").update({
        status: "failed", failure_reason: out.error ?? `HTTP ${res.status}`,
      }).eq("id", sendId);
      return { ok: false, error: out.error ?? `HTTP ${res.status}` };
    }
    // Clear the parent's next_followup_at since we just manually handled it
    await sb.from("sends").update({ next_followup_at: null }).eq("id", parentSendId);
    revalidatePath("/followups");
    revalidatePath("/");
    return { ok: true, sent_to: c.email, step: nextStep };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "dispatch failed" };
  }
}
