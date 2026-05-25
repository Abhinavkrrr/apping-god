"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { render, buildContext, plainToTrackedHtml } from "@/lib/send/render";
import { rewriteCompanyBrief } from "@/lib/send/llm";

const FUNCTION_URL = `https://${process.env.NEXT_PUBLIC_SUPABASE_URL!.split("//")[1].split(".")[0]}.functions.supabase.co/send-worker`;
const DEFAULT_CAMPAIGN_NAME = "Outreach"; // fallback when caller doesn't specify a campaign

interface CompanyRow {
  id: string; name: string; domain: string | null;
  industry: string | null; brief_one_line: string | null;
  recent_news: Record<string, unknown> | null;
}

// ============================================================
// Get the first-touch template for a SPECIFIC campaign (default: Outreach)
// + counts of total contacts / eligible-to-draft for that campaign
// ============================================================
export async function getMasterTemplate(campaignName?: string) {
  const sb = createAdminClient();
  const name = campaignName ?? DEFAULT_CAMPAIGN_NAME;

  const { data: campaign } = await sb.from("campaigns").select("id, name, resume_id")
    .eq("name", name).maybeSingle();
  if (!campaign) return null;

  const { data: seq } = await sb.from("sequences").select("*, templates(*)")
    .eq("campaign_id", campaign.id).eq("step_number", 0).maybeSingle();
  if (!seq) return null;
  const tpl = (seq as any).templates;
  if (!tpl) return null;

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
    campaign_name: campaign.name as string,
    resume_id: campaign.resume_id,
    subject_tmpl: tpl.subject_tmpl as string,
    body_tmpl: tpl.body_tmpl as string,
    total_contacts: totalContacts,
    eligible_contacts: eligible,
  };
}

/** List every active campaign + its first-touch template & eligibility counts.
 * Used by the Generate Modal to populate the campaign dropdown. */
export async function listActiveCampaignTemplates() {
  const sb = createAdminClient();
  const { data: campaigns } = await sb.from("campaigns")
    .select("name").eq("status", "active").order("name");
  const out: NonNullable<Awaited<ReturnType<typeof getMasterTemplate>>>[] = [];
  for (const c of campaigns ?? []) {
    const m = await getMasterTemplate(c.name);
    if (m) out.push(m);
  }
  return out;
}

// ============================================================
// Save edits to master template + re-render all pending drafts
// ============================================================
export async function saveMasterTemplate(templateId: string, subject: string, body: string) {
  const sb = createAdminClient();
  const { error } = await sb.from("templates").update({
    subject_tmpl: subject, body_tmpl: body,
  }).eq("id", templateId);
  if (error) return { ok: false, error: error.message };

  // Re-render every pending_approval draft using this template so the new
  // content shows up immediately in Approve queue + Preview.
  const { data: drafts } = await sb.from("sends").select(`
    id, contacts(first_name, last_name, email, title, companies(id, name, domain, brief_one_line))
  `).eq("template_id", templateId).eq("status", "pending_approval");

  // Parallelize the per-row UPDATEs — UPDATEs can't be batched into one call
  // since each row gets unique rendered_subject/body, but we can issue them
  // concurrently instead of serially. Bounded pool to avoid PgBouncer limits.
  const POOL = 10;
  let rerendered = 0;
  const list = drafts ?? [];
  for (let i = 0; i < list.length; i += POOL) {
    const batch = list.slice(i, i + POOL);
    await Promise.all(batch.map(async (d) => {
      const c = (d as any).contacts;
      if (!c) return;
      const co = c.companies ?? null;
      const ctx = buildContext(c, co, { company_brief_one_line: co?.brief_one_line ?? "" });
      const subj = render(subject, ctx);
      const text = render(body, ctx);
      const html = plainToTrackedHtml(text, d.id);
      await sb.from("sends").update({ rendered_subject: subj, rendered_body: html }).eq("id", d.id);
      rerendered++;
    }));
  }

  revalidatePath("/approve");
  revalidatePath("/templates");
  revalidatePath("/");
  return { ok: true, rerendered };
}

// ============================================================
// GENERATE drafts for a SPECIFIC set of contact IDs (post-import flow)
// ============================================================
export async function generateDraftsForContacts(contactIds: string[], campaignName?: string) {
  const sb = createAdminClient();
  if (!contactIds || contactIds.length === 0) return { ok: false, error: "No contact IDs." };

  const cName = campaignName ?? DEFAULT_CAMPAIGN_NAME;
  const { data: campaign } = await sb.from("campaigns").select("*")
    .eq("name", cName).single();
  if (!campaign) return { ok: false, error: `Campaign "${cName}" not found.` };

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

  // Build all rows in memory first, then batch-insert in ONE round-trip
  // (was N round-trips × 2 inserts = serial Atlantic latency hell)
  const sendRows: any[] = [];
  for (const contact of contacts ?? []) {
    const company = (contact as any).companies as CompanyRow | null;
    const opener = company?.brief_one_line ?? "";
    const sendId = randomUUID();
    const ctx = buildContext(contact as any, company, { company_brief_one_line: opener });
    const subject = render(template.subject_tmpl, ctx);
    const text = render(template.body_tmpl, ctx);
    const html = plainToTrackedHtml(text, sendId);
    sendRows.push({
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
  }

  let created = 0;
  if (sendRows.length > 0) {
    const { data: ins, error } = await sb.from("sends").insert(sendRows).select("id");
    if (error) return { ok: false, error: error.message };
    created = ins?.length ?? 0;
    if (created > 0) {
      await sb.from("approvals").insert(
        (ins ?? []).map((r: any) => ({ send_id: r.id, status: "pending" }))
      );
    }
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
  startFresh?: boolean;
  campaignName?: string;   // which campaign's template to use (default: Outreach)
}) {
  const sb = createAdminClient();
  const useLlm = opts.useLlm ?? false;
  const cName = opts.campaignName ?? DEFAULT_CAMPAIGN_NAME;

  const { data: campaign } = await sb.from("campaigns").select("*")
    .eq("name", cName).single();
  if (!campaign) return { ok: false, error: `Campaign "${cName}" not found.` };

  const { data: seq } = await sb.from("sequences").select("*, templates(*)")
    .eq("campaign_id", campaign.id).eq("step_number", 0).single();
  if (!seq?.templates) return { ok: false, error: "No first-touch template for master campaign." };
  const template = (seq as any).templates;

  // Save edits to template if provided + re-render any existing pending drafts
  if (opts.overrideSubject || opts.overrideBody) {
    await sb.from("templates").update({
      subject_tmpl: opts.overrideSubject ?? template.subject_tmpl,
      body_tmpl: opts.overrideBody ?? template.body_tmpl,
    }).eq("id", template.id);
    template.subject_tmpl = opts.overrideSubject ?? template.subject_tmpl;
    template.body_tmpl = opts.overrideBody ?? template.body_tmpl;

    // Re-render all currently-pending drafts using this template so the
    // edits show up in the Approve queue immediately (parallel, pool of 10).
    const { data: existingDrafts } = await sb.from("sends").select(`
      id, contacts(first_name, last_name, email, title, companies(id, name, domain, brief_one_line))
    `).eq("template_id", template.id).eq("status", "pending_approval");
    const POOL = 10;
    const list = existingDrafts ?? [];
    for (let i = 0; i < list.length; i += POOL) {
      const batch = list.slice(i, i + POOL);
      await Promise.all(batch.map(async (d) => {
        const c = (d as any).contacts;
        if (!c) return;
        const co = c.companies ?? null;
        const ctx = buildContext(c, co, { company_brief_one_line: co?.brief_one_line ?? "" });
        const subj = render(template.subject_tmpl, ctx);
        const text = render(template.body_tmpl, ctx);
        const html = plainToTrackedHtml(text, d.id);
        await sb.from("sends").update({ rendered_subject: subj, rendered_body: html }).eq("id", d.id);
      }));
    }
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

  // Phase 1 (optional): run LLM opener rewrites in parallel with bounded concurrency.
  // Without batching, 50 contacts × 1-3s sequential = 1-3 min. With pool of 5, ~6× faster.
  const openers = new Map<string, string>();
  if (useLlm) {
    const POOL = 5;
    const work = pool.filter(c => (c as any).companies?.id);
    for (let i = 0; i < work.length; i += POOL) {
      const batch = work.slice(i, i + POOL);
      await Promise.all(batch.map(async (c) => {
        const co = (c as any).companies;
        try { openers.set(co.id, await rewriteCompanyBrief(co)); } catch { /* fall back */ }
      }));
    }
  }

  // Phase 2: build all rows in memory (pure CPU work, no I/O)
  const sendRows: any[] = [];
  for (const contact of pool) {
    const company = (contact as any).companies as CompanyRow | null;
    const opener = (company?.id && openers.get(company.id)) || company?.brief_one_line || "";

    const sendId = randomUUID();
    const ctx = buildContext(contact as any, company, { company_brief_one_line: opener });
    const subject = render(template.subject_tmpl, ctx);
    const text = render(template.body_tmpl, ctx);
    const html = plainToTrackedHtml(text, sendId);

    sendRows.push({
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
  }

  // Phase 3: batch insert sends + approvals (2 round-trips total instead of 2N)
  let created = 0, failed = 0;
  if (sendRows.length > 0) {
    const { data: ins, error } = await sb.from("sends").insert(sendRows).select("id");
    if (error) {
      failed = sendRows.length;
    } else {
      created = ins?.length ?? 0;
      failed = sendRows.length - created;
      if (created > 0) {
        await sb.from("approvals").insert(
          (ins ?? []).map((r: any) => ({ send_id: r.id, status: "pending" }))
        );
      }
    }
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

    // ATOMIC CLAIM: only succeed if status is still 'pending_approval'.
    // Prevents double-send when two clicks/runs race on the same row.
    const { data: claimed } = await sb.from("sends").update({
      status: "approved", scheduled_at: new Date().toISOString(),
    }).eq("id", send.id).eq("status", "pending_approval").select("id");
    if (!claimed || claimed.length === 0) { skipped++; continue; }

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
// SCHEDULE all pending for a custom date+time (UTC ISO)
// If no time given, defaults to tomorrow 10:30 AM IST.
// ============================================================
export interface ScheduleOpts {
  scheduledAtIso?: string;  // explicit UTC ISO (takes precedence)
  hour?: number;            // legacy: hour in IST
  minute?: number;          // legacy: minute in IST
}

export async function schedulePendingForTomorrow(opts?: ScheduleOpts) {
  return schedulePendingByIds(undefined, opts);
}

export async function scheduleSelectedForTomorrow(sendIds: string[], opts?: ScheduleOpts) {
  if (!sendIds || sendIds.length === 0) {
    return { ok: false, error: "No drafts selected." };
  }
  return schedulePendingByIds(sendIds, opts);
}

function resolveScheduledAt(opts?: ScheduleOpts): Date {
  if (opts?.scheduledAtIso) {
    const d = new Date(opts.scheduledAtIso);
    const now = Date.now();
    const ninetyDays = 90 * 86400_000;
    // Sanity bounds: must be in the future, within 90 days.
    if (!isNaN(d.getTime()) && d.getTime() > now && d.getTime() - now < ninetyDays) return d;
  }
  const hour = opts?.hour ?? 10;
  const minute = opts?.minute ?? 30;
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1,
    hour - 5, minute - 30, 0
  ));
}

// ============================================================
// CANCEL a scheduled send (reverts back to pending_approval)
// ============================================================
export async function cancelScheduledSend(sendId: string) {
  return cancelScheduledByIds([sendId]);
}

export async function cancelScheduledSends(sendIds: string[]) {
  if (!sendIds || sendIds.length === 0) {
    return { ok: false, error: "No sends selected." };
  }
  return cancelScheduledByIds(sendIds);
}

export async function cancelAllScheduled() {
  return cancelScheduledByIds(undefined);
}

async function cancelScheduledByIds(sendIds: string[] | undefined) {
  const sb = createAdminClient();
  let q = sb.from("sends").select("id").eq("status", "approved").is("sent_at", null);
  if (sendIds && sendIds.length > 0) q = q.in("id", sendIds);
  const { data: scheduled } = await q;
  if (!scheduled || scheduled.length === 0) {
    return { ok: false, error: "No scheduled sends to cancel." };
  }
  const ids = scheduled.map((s: any) => s.id);

  await sb.from("sends").update({
    status: "pending_approval", scheduled_at: null,
  }).in("id", ids);
  await sb.from("approvals").update({
    status: "pending", reviewed_at: null,
  }).in("send_id", ids);

  revalidatePath("/approve");
  revalidatePath("/scheduled");
  revalidatePath("/");
  return { ok: true, cancelled: ids.length };
}

async function schedulePendingByIds(sendIds: string[] | undefined, opts?: ScheduleOpts) {
  const sb = createAdminClient();
  const scheduledAt = resolveScheduledAt(opts);

  let q = sb.from("sends").select("id").eq("status", "pending_approval");
  if (sendIds && sendIds.length > 0) q = q.in("id", sendIds);
  const { data: pending } = await q;
  if (!pending || pending.length === 0) {
    return { ok: false, error: "No pending drafts to schedule." };
  }
  const ids = pending.map((s: any) => s.id);

  await sb.from("sends").update({
    status: "approved", scheduled_at: scheduledAt.toISOString(),
  }).in("id", ids);
  await sb.from("approvals").update({
    status: "approved", reviewed_at: new Date().toISOString(),
  }).in("send_id", ids);

  revalidatePath("/approve");
  revalidatePath("/");

  // Render scheduled time in IST for the toast
  const localStr = scheduledAt.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
  return {
    ok: true, scheduled: ids.length,
    scheduled_at_utc: scheduledAt.toISOString(),
    scheduled_at_local: `${localStr} IST`,
  };
}
