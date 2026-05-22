"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { render, buildContext, plainToTrackedHtml, plainWithFooter } from "@/lib/send/render";
import { rewriteCompanyBrief } from "@/lib/send/llm";

const FUNCTION_URL = `https://${process.env.NEXT_PUBLIC_SUPABASE_URL!.split("//")[1].split(".")[0]}.functions.supabase.co/send-worker`;

interface Company {
  id: string; name: string; domain: string | null;
  industry: string | null; brief_one_line: string | null;
  recent_news: Record<string, unknown> | null;
}

// ============================================================
// GENERATE drafts (pending_approval) for active campaigns
// ============================================================
export async function generateDrafts(opts: {
  campaign?: string; // campaign name filter; if omitted, all active
  limit?: number;    // max drafts to create
  useLlm?: boolean;  // call Gemini for opener rewrite
}) {
  const sb = createAdminClient();
  const limit = opts.limit ?? 50;
  const useLlm = opts.useLlm ?? true;

  let cq = sb.from("campaigns").select("*").eq("status", "active");
  if (opts.campaign) cq = cq.eq("name", opts.campaign);
  const { data: campaigns } = await cq;
  if (!campaigns || campaigns.length === 0) {
    return { ok: false, error: "No active campaigns. Set at least one campaign to 'active' first." };
  }

  let created = 0;
  for (const campaign of campaigns) {
    if (created >= limit) break;

    const { data: seq } = await sb.from("sequences").select("*, templates(*)")
      .eq("campaign_id", campaign.id).eq("step_number", 0).maybeSingle();
    if (!seq?.templates) continue;
    const template = (seq as any).templates;

    const { data: tagged } = await sb.from("contacts").select("*, companies(*)")
      .contains("custom_fields", { campaign_tag: campaign.name })
      .is("unsubscribed_at", null).is("skip_reason", null);

    if (!tagged || tagged.length === 0) continue;

    const { data: existing } = await sb.from("sends").select("contact_id")
      .eq("campaign_id", campaign.id).in("status", ["pending_approval", "approved", "sending", "sent"]);
    const touched = new Set((existing ?? []).map((e: any) => e.contact_id));
    const pool = tagged.filter((c: any) => !touched.has(c.id));

    for (const contact of pool) {
      if (created >= limit) break;
      const company = (contact as any).companies as Company | null;
      let opener = company?.brief_one_line ?? "";
      if (useLlm && company?.id) opener = await rewriteCompanyBrief(company);

      const sendId = randomUUID();
      const ctx = buildContext(contact as any, company, { company_brief_one_line: opener });
      const subject = render(template.subject_tmpl, ctx);
      const text = render(template.body_tmpl, ctx);
      const html = plainToTrackedHtml(text, sendId);

      const { error } = await sb.from("sends").insert({
        id: sendId,
        contact_id: (contact as any).id,
        campaign_id: campaign.id,
        sequence_step: 0,
        template_id: template.id,
        resume_id: campaign.resume_id,
        rendered_subject: subject,
        rendered_body: html,
        status: "pending_approval",
      });
      if (error) continue;
      await sb.from("approvals").insert({ send_id: sendId, status: "pending" });
      created++;
    }
  }

  revalidatePath("/approve");
  revalidatePath("/");
  return { ok: true, created };
}

// ============================================================
// SEND ALL pending NOW — approve + dispatch immediately
// ============================================================
export async function sendAllPendingNow(opts?: { limit?: number }) {
  const sb = createAdminClient();
  const limit = opts?.limit ?? 25;

  const { data: pending } = await sb.from("sends").select(`
    id, resume_id, rendered_subject, rendered_body,
    contacts(email, unsubscribed_at)
  `).eq("status", "pending_approval").limit(limit);

  if (!pending || pending.length === 0) {
    return { ok: false, error: "No pending drafts. Generate some first." };
  }

  let sent = 0, failed = 0, skipped = 0;
  for (const send of pending) {
    const c = (send as any).contacts;
    if (!c?.email || c?.unsubscribed_at) { skipped++; continue; }

    // Mark approved + scheduled now
    await sb.from("sends").update({
      status: "approved",
      scheduled_at: new Date().toISOString(),
    }).eq("id", send.id);
    await sb.from("approvals").update({
      status: "approved", reviewed_at: new Date().toISOString(),
    }).eq("send_id", send.id);

    // Dispatch
    try {
      const res = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: c.email,
          subject: send.rendered_subject,
          text_body: send.rendered_body,
          html_body: send.rendered_body,
          resume_id: send.resume_id,
          log_send_id: send.id,
        }),
      });
      const out = await res.json();
      if (res.ok && out.ok) {
        const next = new Date(Date.now() + 2 * 86400_000).toISOString();
        await sb.from("sends").update({ next_followup_at: next }).eq("id", send.id);
        sent++;
      } else {
        await sb.from("sends").update({
          status: "failed",
          failure_reason: out.error ?? `HTTP ${res.status}`,
        }).eq("id", send.id);
        failed++;
      }
    } catch (e) {
      failed++;
    }
  }

  revalidatePath("/approve");
  revalidatePath("/");
  return { ok: true, sent, failed, skipped };
}

// ============================================================
// SCHEDULE ALL pending for tomorrow 10:30 IST
// ============================================================
export async function schedulePendingForTomorrow(opts?: { hour?: number; minute?: number }) {
  const sb = createAdminClient();
  const hour = opts?.hour ?? 10;
  const minute = opts?.minute ?? 30;

  // Tomorrow at hour:minute IST (IST = UTC+5:30)
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1,
    hour - 5, minute - 30, 0
  ));

  const { data: pending } = await sb.from("sends").select("id")
    .eq("status", "pending_approval");
  if (!pending || pending.length === 0) {
    return { ok: false, error: "No pending drafts to schedule." };
  }
  const ids = pending.map((s: any) => s.id);

  await sb.from("sends").update({
    status: "approved", scheduled_at: tomorrow.toISOString(),
  }).in("id", ids);
  await sb.from("approvals").update({
    status: "approved", reviewed_at: new Date().toISOString(),
  }).in("send_id", ids);

  revalidatePath("/approve");
  revalidatePath("/");
  return {
    ok: true,
    scheduled: ids.length,
    scheduled_at_utc: tomorrow.toISOString(),
    scheduled_at_local: `${hour}:${String(minute).padStart(2, "0")} IST tomorrow`,
  };
}
