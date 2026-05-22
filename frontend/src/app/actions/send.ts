"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { render, buildContext, plainToTrackedHtml } from "@/lib/send/render";
import { rewriteCompanyBrief } from "@/lib/send/llm";

const FUNCTION_URL = `https://${process.env.NEXT_PUBLIC_SUPABASE_URL!.split("//")[1].split(".")[0]}.functions.supabase.co/send-worker`;
const MASTER_CAMPAIGN_NAME = "Outreach"; // single master campaign for all contacts

interface CompanyRow {
  id: string; name: string; domain: string | null;
  industry: string | null; brief_one_line: string | null;
  recent_news: Record<string, unknown> | null;
}

// ============================================================
// Get the master template (used for ALL contacts in the new flow)
// ============================================================
export async function getMasterTemplate() {
  const sb = createAdminClient();
  const { data: campaign } = await sb.from("campaigns").select("id, resume_id")
    .eq("name", MASTER_CAMPAIGN_NAME).single();
  if (!campaign) return null;

  const { data: seq } = await sb.from("sequences").select("*, templates(*)")
    .eq("campaign_id", campaign.id).eq("step_number", 0).single();
  if (!seq) return null;
  const tpl = (seq as any).templates;

  // Count eligible contacts (not unsubscribed, not skipped, not already drafted in master campaign)
  const { data: allContacts } = await sb.from("contacts")
    .select("id").is("unsubscribed_at", null).is("skip_reason", null);
  const totalContacts = allContacts?.length ?? 0;

  const { data: touched } = await sb.from("sends").select("contact_id")
    .eq("campaign_id", campaign.id)
    .in("status", ["pending_approval", "approved", "sending", "sent"]);
  const touchedSet = new Set((touched ?? []).map((t: any) => t.contact_id));
  const eligible = (allContacts ?? []).filter(c => !touchedSet.has(c.id)).length;

  return {
    template_id: tpl.id,
    campaign_id: campaign.id,
    resume_id: campaign.resume_id,
    subject_tmpl: tpl.subject_tmpl as string,
    body_tmpl: tpl.body_tmpl as string,
    total_contacts: totalContacts,
    eligible_contacts: eligible,
  };
}

// ============================================================
// Save edits to master template
// ============================================================
export async function saveMasterTemplate(templateId: string, subject: string, body: string) {
  const sb = createAdminClient();
  const { error } = await sb.from("templates").update({
    subject_tmpl: subject, body_tmpl: body,
  }).eq("id", templateId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/approve");
  revalidatePath("/templates");
  return { ok: true };
}

// ============================================================
// GENERATE drafts for a SPECIFIC set of contact IDs (post-import flow)
// ============================================================
export async function generateDraftsForContacts(contactIds: string[]) {
  const sb = createAdminClient();
  if (!contactIds || contactIds.length === 0) return { ok: false, error: "No contact IDs." };

  const { data: campaign } = await sb.from("campaigns").select("*")
    .eq("name", MASTER_CAMPAIGN_NAME).single();
  if (!campaign) return { ok: false, error: `Master campaign "${MASTER_CAMPAIGN_NAME}" not found.` };

  const { data: seq } = await sb.from("sequences").select("*, templates(*)")
    .eq("campaign_id", campaign.id).eq("step_number", 0).single();
  if (!seq?.templates) return { ok: false, error: "Master template not found." };
  const template = (seq as any).templates;

  // Dedupe against existing drafts/sends
  const { data: existing } = await sb.from("sends").select("contact_id")
    .eq("campaign_id", campaign.id)
    .in("status", ["pending_approval", "approved", "sending", "sent"])
    .in("contact_id", contactIds);
  const touched = new Set((existing ?? []).map((e: any) => e.contact_id));

  const eligibleIds = contactIds.filter(id => !touched.has(id));
  if (eligibleIds.length === 0) return { ok: true, created: 0, skipped: contactIds.length };

  const { data: contacts } = await sb.from("contacts")
    .select("*, companies(*)").in("id", eligibleIds)
    .is("unsubscribed_at", null).is("skip_reason", null);

  let created = 0;
  for (const contact of contacts ?? []) {
    const company = (contact as any).companies as CompanyRow | null;
    const opener = company?.brief_one_line ?? "";

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

  revalidatePath("/approve");
  revalidatePath("/");
  return { ok: true, created, skipped: contactIds.length - created };
}

// ============================================================
// GENERATE drafts — uses master template for ALL eligible contacts
// (campaign status is IGNORED — every contact is processed)
// ============================================================
export async function generateDrafts(opts: {
  overrideSubject?: string;
  overrideBody?: string;
  useLlm?: boolean;
  startFresh?: boolean; // delete existing pending_approval drafts first
}) {
  const sb = createAdminClient();
  const useLlm = opts.useLlm ?? false;

  // Get master campaign + template
  const { data: campaign } = await sb.from("campaigns").select("*")
    .eq("name", MASTER_CAMPAIGN_NAME).single();
  if (!campaign) return { ok: false, error: `Master campaign "${MASTER_CAMPAIGN_NAME}" not found.` };

  const { data: seq } = await sb.from("sequences").select("*, templates(*)")
    .eq("campaign_id", campaign.id).eq("step_number", 0).single();
  if (!seq?.templates) return { ok: false, error: "No first-touch template for master campaign." };
  const template = (seq as any).templates;

  // Save edits to template if provided
  if (opts.overrideSubject || opts.overrideBody) {
    await sb.from("templates").update({
      subject_tmpl: opts.overrideSubject ?? template.subject_tmpl,
      body_tmpl: opts.overrideBody ?? template.body_tmpl,
    }).eq("id", template.id);
    template.subject_tmpl = opts.overrideSubject ?? template.subject_tmpl;
    template.body_tmpl = opts.overrideBody ?? template.body_tmpl;
  }

  // Optionally clear existing drafts
  if (opts.startFresh) {
    const { data: oldDrafts } = await sb.from("sends").select("id")
      .eq("campaign_id", campaign.id).eq("status", "pending_approval");
    const ids = (oldDrafts ?? []).map((d: any) => d.id);
    if (ids.length > 0) {
      await sb.from("approvals").delete().in("send_id", ids);
      await sb.from("sends").delete().in("id", ids);
    }
  }

  // ALL contacts (not just campaign-tagged) — this is the key change
  const { data: contacts } = await sb.from("contacts")
    .select("*, companies(*)").is("unsubscribed_at", null).is("skip_reason", null);

  if (!contacts || contacts.length === 0) {
    return { ok: false, error: "No eligible contacts." };
  }

  // Dedupe vs existing
  const { data: existing } = await sb.from("sends").select("contact_id")
    .eq("campaign_id", campaign.id)
    .in("status", ["pending_approval", "approved", "sending", "sent"]);
  const touched = new Set((existing ?? []).map((e: any) => e.contact_id));
  const pool = (contacts as any[]).filter(c => !touched.has(c.id));

  let created = 0, failed = 0;
  for (const contact of pool) {
    const company = (contact as any).companies as CompanyRow | null;
    let opener = company?.brief_one_line ?? "";
    if (useLlm && company?.id) {
      try { opener = await rewriteCompanyBrief(company); } catch { /* fall back */ }
    }

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
    if (error) { failed++; continue; }
    await sb.from("approvals").insert({ send_id: sendId, status: "pending" });
    created++;
  }

  revalidatePath("/approve");
  revalidatePath("/");
  return { ok: true, created, failed, total_eligible: pool.length };
}

// ============================================================
// SEND ALL pending NOW
// ============================================================
export async function sendAllPendingNow() {
  return sendPendingByIds(undefined);
}

// ============================================================
// SEND a specific set of pending drafts (selected in dashboard)
// ============================================================
export async function sendSelectedPending(sendIds: string[]) {
  if (!sendIds || sendIds.length === 0) {
    return { ok: false, error: "No drafts selected." };
  }
  return sendPendingByIds(sendIds);
}

async function sendPendingByIds(sendIds: string[] | undefined) {
  const sb = createAdminClient();

  let q = sb.from("sends").select(`
    id, resume_id, rendered_subject, rendered_body,
    contacts(email, unsubscribed_at)
  `).eq("status", "pending_approval");
  if (sendIds && sendIds.length > 0) q = q.in("id", sendIds);

  const { data: pending } = await q;
  if (!pending || pending.length === 0) {
    return { ok: false, error: "No pending drafts to send." };
  }

  let sent = 0, failed = 0, skipped = 0;
  for (const send of pending) {
    const c = (send as any).contacts;
    if (!c?.email || c?.unsubscribed_at) { skipped++; continue; }

    await sb.from("sends").update({
      status: "approved", scheduled_at: new Date().toISOString(),
    }).eq("id", send.id);
    await sb.from("approvals").update({
      status: "approved", reviewed_at: new Date().toISOString(),
    }).eq("send_id", send.id);

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
          status: "failed", failure_reason: out.error ?? `HTTP ${res.status}`,
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
    ok: true, scheduled: ids.length,
    scheduled_at_utc: tomorrow.toISOString(),
    scheduled_at_local: `${hour}:${String(minute).padStart(2, "0")} IST tomorrow`,
  };
}
