"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { render, buildContext, plainToTrackedHtml } from "@/lib/send/render";
import { rewriteCompanyBrief } from "@/lib/send/llm";

// NOTE: the dashboard no longer dispatches sends directly via the Supabase
// Edge Function (used to be FUNCTION_URL = `${SUPABASE_URL}/functions/v1/send-worker`).
// All sending now flows through the GitHub Actions cron dispatcher
// (scripts/dispatch_approved.js → send-worker), so the dashboard process
// can die at any time without dropping a batch.
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

  // Per-campaign touched (old definition — used when opt-in cross-campaign is on)
  const { data: touchedThis } = await sb.from("sends").select("contact_id")
    .eq("campaign_id", campaign.id)
    .in("status", ["pending_approval", "approved", "sending", "sent"]);
  const touchedThisSet = new Set((touchedThis ?? []).map((t: any) => t.contact_id));
  const eligibleSameCampaign = (allContacts ?? []).filter(c => !touchedThisSet.has(c.id)).length;

  // Globally touched (default behavior — won't pitch someone who's in ANY other campaign)
  const { data: touchedAny } = await sb.from("sends").select("contact_id")
    .in("status", ["pending_approval", "approved", "sending", "sent"]);
  const touchedAnySet = new Set((touchedAny ?? []).map((t: any) => t.contact_id));
  const eligibleGlobal = (allContacts ?? []).filter(c => !touchedAnySet.has(c.id)).length;

  return {
    template_id: tpl.id,
    campaign_id: campaign.id,
    campaign_name: campaign.name as string,
    resume_id: campaign.resume_id,
    subject_tmpl: tpl.subject_tmpl as string,
    body_tmpl: tpl.body_tmpl as string,
    total_contacts: totalContacts,
    eligible_contacts: eligibleSameCampaign,        // default = per-campaign dedup (matches old behavior)
    eligible_contacts_global: eligibleGlobal,       // when globalDedup is on
    cross_campaign_collisions: eligibleSameCampaign - eligibleGlobal,
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
export async function generateDraftsForContacts(
  contactIds: string[],
  campaignName?: string,
  opts: { globalDedup?: boolean } = {}
) {
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

  // Per-campaign dedup: only skip contacts already touched in THIS campaign.
  // Same contact can legitimately appear in multiple campaigns (different
  // products = different pitches). The Approve queue is the safety net —
  // user just shouldn't approve two same-day pitches to the same person.
  // Set opts.globalDedup to skip contacts touched in ANY campaign.
  const dedupQuery = sb.from("sends").select("contact_id")
    .in("status", ["pending_approval", "approved", "sending", "sent"])
    .in("contact_id", contactIds);
  if (!opts.globalDedup) dedupQuery.eq("campaign_id", campaign.id);
  const { data: existing } = await dedupQuery;
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
  campaignName?: string;       // which campaign's template to use (default: Outreach)
  globalDedup?: boolean;       // opt-in: also skip contacts touched in OTHER campaigns
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

  // Per-campaign dedup: each campaign is its own funnel, so the same contact
  // can be pitched on both (e.g. internship outreach + SaaS sales pitch).
  // Opt-in to global dedup via opts.globalDedup when you don't want a contact
  // to appear in multiple campaigns simultaneously.
  const dedupQuery = sb.from("sends").select("contact_id")
    .in("status", ["pending_approval", "approved", "sending", "sent"]);
  if (!opts.globalDedup) dedupQuery.eq("campaign_id", campaign.id);
  const { data: existing } = await dedupQuery;
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

// ─────────────────────────────────────────────────────────────
// CLOUD-DISPATCH SEND
//
// IMPORTANT CHANGE FROM PRIOR BEHAVIOR (commit bc2875a → now):
// "Send NOW" used to loop through every send in the dashboard's
// server-action process and fire each one via the Supabase Edge
// function inline. If the user closed their laptop mid-batch, the
// loop died and only the already-fired sends went out.
//
// New behavior: we ATOMICALLY mark every selected draft as 'approved'
// with scheduled_at = NOW, then return immediately. The GitHub Actions
// cron job (dispatch-scheduled.yml, every 15 min) drains them from the
// cloud — completely independent of whether the user's laptop is open.
//
// Trade-off: up to 15-min latency until the first send fires after a
// click, instead of "starts immediately". User can also manually
// trigger the workflow from GitHub Actions UI to skip the wait.
// ─────────────────────────────────────────────────────────────
async function sendPendingByIds(sendIds: string[] | undefined) {
  const sb = createAdminClient();

  let q = sb.from("sends").select(`id, contacts(email, unsubscribed_at)`)
    .eq("status", "pending_approval");
  if (sendIds && sendIds.length > 0) q = q.in("id", sendIds);

  const { data: pending } = await q;
  if (!pending || pending.length === 0) {
    return { ok: false, error: "No pending drafts to send." };
  }

  // Partition: contacts with no email or already unsubscribed get auto-skipped.
  const queueIds: string[] = [];
  const skipIds: string[] = [];
  for (const send of pending) {
    const c = (send as any).contacts;
    if (!c?.email || c?.unsubscribed_at) skipIds.push((send as any).id);
    else queueIds.push((send as any).id);
  }

  const nowIso = new Date().toISOString();

  // Bulk-mark the un-sendable ones (no email / unsubscribed) — kept as an
  // audit trail of why they weren't sent.
  if (skipIds.length > 0) {
    await sb.from("sends").update({
      status: "skipped",
      failure_reason: "Contact has no email or has unsubscribed",
    }).in("id", skipIds);
    await sb.from("approvals").update({ status: "skipped" }).in("send_id", skipIds);
  }

  // Bulk-queue the sendable ones with scheduled_at = NOW so the cloud
  // dispatcher picks them up on its next 15-min tick. Atomic via the
  // status='pending_approval' filter — only flips drafts that haven't
  // already been claimed by something else.
  let queued = 0;
  if (queueIds.length > 0) {
    const { data: claimed } = await sb.from("sends").update({
      status: "approved",
      scheduled_at: nowIso,
    }).in("id", queueIds).eq("status", "pending_approval").select("id");
    queued = claimed?.length ?? 0;
    if (queued > 0) {
      await sb.from("approvals").update({
        status: "approved", reviewed_at: nowIso,
      }).in("send_id", (claimed ?? []).map((c: any) => c.id));
    }
  }

  revalidatePath("/approve");
  revalidatePath("/scheduled");
  revalidatePath("/sends");
  revalidatePath("/");
  return {
    ok: true,
    queued,
    skipped: skipIds.length,
    cloud_dispatched: true,  // flag for the UI to show the right toast
  };

  /* ─── LEGACY INLINE LOOP (deleted; see commit a745d73 for the version
   * that looped through every send in the dashboard process. Removed
   * because closing the laptop killed in-flight batches. The cloud-
   * dispatch model above is the new default.) ───────────────────── */
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
