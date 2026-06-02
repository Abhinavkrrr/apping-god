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
  opts: { globalDedup?: boolean; switchCampaign?: boolean; forceRegenerate?: boolean } = {}
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

  // FORCE REGENERATE: when set (typically from "re-create fresh drafts"
  // checkbox on the import modal), wipe ALL existing pending drafts for
  // these contacts in the target campaign so the dedup-skip below doesn't
  // silently drop them. Result: every contactId in the input gets exactly
  // 1 fresh pending draft in the target campaign. This is what the user
  // expects when they re-import a CSV and want all contacts in queue.
  let force_deleted = 0;
  if (opts.forceRegenerate) {
    const { data: doomed } = await sb.from("sends")
      .select("id")
      .eq("campaign_id", campaign.id)
      .eq("status", "pending_approval")
      .in("contact_id", contactIds);
    if (doomed && doomed.length > 0) {
      const ids = doomed.map((d: any) => d.id);
      await sb.from("approvals").delete().in("send_id", ids);
      await sb.from("sends").delete().in("id", ids);
      force_deleted = ids.length;
    }
  }

  // NEW DEFAULT (switchCampaign=true): treat each contact as having ONE
  // active campaign at a time. If a contact has pending drafts in OTHER
  // campaigns when we go to generate here, those get deleted first so
  // they don't end up with 2 or 3 simultaneous pending pitches.
  // Set switchCampaign=false to keep the old "draft per campaign per
  // contact" behavior (rare — only useful for true multi-channel pitches
  // where you genuinely want the same contact in both Outreach AND SaaS
  // queues at the same time).
  const switchCampaign = opts.switchCampaign ?? true;
  let cleaned_other_campaigns = 0;
  if (switchCampaign) {
    const { data: otherDrafts } = await sb.from("sends")
      .select("id")
      .neq("campaign_id", campaign.id)
      .eq("status", "pending_approval")
      .in("contact_id", contactIds);
    if (otherDrafts && otherDrafts.length > 0) {
      const ids = otherDrafts.map((d: any) => d.id);
      await sb.from("approvals").delete().in("send_id", ids);
      await sb.from("sends").delete().in("id", ids);
      cleaned_other_campaigns = ids.length;
    }
  }

  // Per-campaign dedup: skip contacts already touched in THIS campaign so
  // we don't double-draft. switchCampaign above already cleared other
  // campaigns; this only catches "already pitched on this campaign".
  // Opt-in opts.globalDedup adds the rare "skip across all campaigns" mode.
  const dedupQuery = sb.from("sends").select("contact_id")
    .in("status", ["pending_approval", "approved", "sending", "sent"])
    .in("contact_id", contactIds);
  if (!opts.globalDedup) dedupQuery.eq("campaign_id", campaign.id);
  const { data: existing } = await dedupQuery;
  const touched = new Set((existing ?? []).map((e: any) => e.contact_id));

  const eligibleIds = contactIds.filter(id => !touched.has(id));
  if (eligibleIds.length === 0) {
    return { ok: true, created: 0, skipped: contactIds.length, cleaned_other_campaigns };
  }

  // PAGINATED fetch — Supabase caps single queries at 1000 rows even
  // when .in() filter would match more. Page through using .range()
  // chunks of 500 (smaller because each row also joins companies).
  const contacts: any[] = [];
  const FETCH_CHUNK = 500;
  for (let i = 0; i < eligibleIds.length; i += FETCH_CHUNK) {
    const idChunk = eligibleIds.slice(i, i + FETCH_CHUNK);
    const { data: page } = await sb.from("contacts")
      .select("*, companies(*)").in("id", idChunk)
      .is("unsubscribed_at", null).is("skip_reason", null);
    if (page) contacts.push(...page);
  }

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
  return {
    ok: true, created,
    skipped: contactIds.length - created,
    cleaned_other_campaigns, force_deleted,
  };
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
  campaignName?: string;        // which campaign's template to use (default: Outreach)
  globalDedup?: boolean;        // opt-in: also skip contacts touched in OTHER campaigns
  switchCampaign?: boolean;     // NEW DEFAULT (true): delete pending drafts in OTHER campaigns for these contacts before generating here. Result: 1 contact = 1 pending draft at a time.
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

  // NEW DEFAULT (switchCampaign=true): clear OTHER-campaign pending drafts
  // for every contact in our candidate pool. Result: 1 contact = 1 pending
  // draft at a time. Generating for Outreach after the user generated for
  // SaaS Sales for the same batch will wipe the SaaS Sales drafts.
  // Set switchCampaign=false to keep the legacy "draft per campaign per
  // contact" behavior (only useful for true multi-channel pitches).
  const switchCampaign = opts.switchCampaign ?? true;
  let cleaned_other_campaigns = 0;
  if (switchCampaign && contacts.length > 0) {
    const allContactIds = (contacts as any[]).map(c => c.id);
    const { data: otherDrafts } = await sb.from("sends")
      .select("id")
      .neq("campaign_id", campaign.id)
      .eq("status", "pending_approval")
      .in("contact_id", allContactIds);
    if (otherDrafts && otherDrafts.length > 0) {
      const ids = otherDrafts.map((d: any) => d.id);
      await sb.from("approvals").delete().in("send_id", ids);
      await sb.from("sends").delete().in("id", ids);
      cleaned_other_campaigns = ids.length;
    }
  }

  // Per-campaign dedup: skip contacts already touched in THIS campaign so
  // we don't double-draft. switchCampaign above already cleared the OTHER
  // campaigns; this only catches "already has a pending draft on this
  // campaign". Opt-in opts.globalDedup adds the rare "skip across all" mode.
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
  return {
    ok: true, created, failed,
    total_eligible: pool.length,
    cleaned_other_campaigns,
  };
}

// ============================================================
// REGENERATE drafts for a batch — nuclear "fix my batch" button
// ============================================================
//
// For every contact in the given import_batch_id, delete ALL their
// pending drafts (any campaign) and create a fresh one in the target
// campaign. Bypasses per-campaign dedup entirely. Used when:
//   - User imported a CSV but the batch chip shows 0 drafts because
//     auto-generate got skipped/blocked
//   - User wants to "reset" a batch to a different campaign
//   - Existing drafts have stale content and need refresh
//
// Returns counts so the UI toast can show the full impact.
export async function regenerateDraftsForBatch(
  batchId: string,
  campaignName?: string
): Promise<{
  ok: boolean;
  contacts?: number;
  unblocked_skip?: number;
  unblocked_unsub?: number;
  unsubscribes_removed?: number;
  deleted?: number;
  created?: number;
  campaign?: string;
  error?: string;
}> {
  const sb = createAdminClient();
  const cName = campaignName ?? DEFAULT_CAMPAIGN_NAME;

  // 1. Resolve campaign
  const { data: campaign } = await sb.from("campaigns").select("id, name")
    .eq("name", cName).single();
  if (!campaign) return { ok: false, error: `Campaign "${cName}" not found.` };

  // 2. PAGINATED fetch of all contacts in this batch.
  // Supabase enforces a server-side max-rows cap (default 1000). Even
  // with .range(0, 49999) we get capped at 1000. The ONLY way to fetch
  // more is to page through with sequential .range(start, end-1) calls.
  const allContacts: any[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data: page, error: pageErr } = await sb.from("contacts")
      .select("id, email, skip_reason, email_status, unsubscribed_at")
      .eq("import_batch_id", batchId)
      .order("id")   // deterministic ordering for stable pagination
      .range(offset, offset + PAGE - 1);
    if (pageErr) {
      return { ok: false, error: `Contact-fetch page ${offset} failed: ${pageErr.message}` };
    }
    if (!page || page.length === 0) break;
    allContacts.push(...page);
    if (page.length < PAGE) break;     // last partial page
    offset += PAGE;
    if (offset > 50000) break;         // sanity limit; far beyond realistic batch sizes
  }

  const contactIds = allContacts.map(c => c.id);
  const emails = allContacts.map(c => (c.email || "").toLowerCase()).filter(Boolean);

  if (contactIds.length === 0) {
    return { ok: false, error: "No contacts in this batch." };
  }

  // 3. NUCLEAR UNBLOCK — when user explicitly clicks Regenerate they
  // want drafts created for these contacts, period. Clear ALL filters
  // that would cause generateDraftsForContacts to silently drop them:
  //
  //   - skip_reason         → NULL (any value, not just bounce-related)
  //   - email_status        → 'unverified' (any value, not just 'bounced')
  //   - unsubscribed_at     → NULL  (yes, even manual unsubs — explicit
  //                                  user intent at the Regenerate click)
  //   - unsubscribes table  → delete every entry matching these emails
  //
  // Rationale: the user just clicked a button labeled "Regenerate drafts
  // for batch X". That's explicit intent to bypass any block. If they
  // wanted to preserve unsub state, they wouldn't be regenerating for
  // that contact at all.
  let unblocked_skip = 0;
  let unblocked_unsub = 0;
  let unsubscribes_removed = 0;

  // Chunk the contact-update too in case >1000 per call
  const UPDATE_CHUNK = 500;
  for (let i = 0; i < contactIds.length; i += UPDATE_CHUNK) {
    const chunk = contactIds.slice(i, i + UPDATE_CHUNK);

    // Clear skip_reason + email_status (anything that's set gets cleared)
    const { data: clearedSkip } = await sb.from("contacts")
      .update({ skip_reason: null, email_status: "unverified" })
      .in("id", chunk)
      .not("skip_reason", "is", null)
      .select("id");
    unblocked_skip += clearedSkip?.length ?? 0;

    // Clear unsubscribed_at separately (different filter)
    const { data: clearedUnsub } = await sb.from("contacts")
      .update({ unsubscribed_at: null })
      .in("id", chunk)
      .not("unsubscribed_at", "is", null)
      .select("id");
    unblocked_unsub += clearedUnsub?.length ?? 0;
  }

  // Remove from unsubscribes table (every reason, since explicit
  // regenerate intent). Chunked to avoid URL overflow.
  if (emails.length > 0) {
    const EMAIL_CHUNK = 250;
    for (let i = 0; i < emails.length; i += EMAIL_CHUNK) {
      const chunk = emails.slice(i, i + EMAIL_CHUNK);
      const { data: removed } = await sb.from("unsubscribes")
        .delete()
        .in("email", chunk)
        .select("email");
      unsubscribes_removed += removed?.length ?? 0;
    }
  }

  // 4. Generate with forceRegenerate. Chunk contactIds since
  // generateDraftsForContacts also has its own internal .in() queries.
  let totalCreated = 0;
  let totalDeleted = 0;
  const GEN_CHUNK = 500;
  for (let i = 0; i < contactIds.length; i += GEN_CHUNK) {
    const chunk = contactIds.slice(i, i + GEN_CHUNK);
    const r = await generateDraftsForContacts(chunk, cName, {
      forceRegenerate: true,
      switchCampaign: true,
    });
    if (!r.ok) {
      return {
        ok: false,
        error: `Chunk ${i}-${i+GEN_CHUNK} failed: ${r.error}`,
        contacts: contactIds.length,
        unblocked_skip, unblocked_unsub, unsubscribes_removed,
        created: totalCreated, deleted: totalDeleted,
        campaign: campaign.name as string,
      };
    }
    totalCreated += r.created ?? 0;
    totalDeleted += r.force_deleted ?? 0;
  }

  return {
    ok: true,
    contacts: contactIds.length,
    unblocked_skip, unblocked_unsub, unsubscribes_removed,
    deleted: totalDeleted,
    created: totalCreated,
    campaign: campaign.name as string,
  };
}

// ============================================================
// CONSOLIDATE pending drafts — collapse to 1 per contact
// ============================================================
//
// For each contact with > 1 pending_approval draft, keep the MOST RECENT
// one and delete the rest. Used to clean up the legacy multi-campaign
// state where the same contact had drafts in 2 or 3 campaigns
// simultaneously. After running this, /approve's "Select all" count
// will match the chip count (which already shows unique contacts).
//
// approvals.send_id is ON DELETE CASCADE so we only touch the sends
// table; approval rows for deleted sends auto-clean.
export async function consolidatePendingDrafts(opts: {
  contactIds?: string[];  // optional: limit cleanup to these contacts. Default: all.
} = {}): Promise<{
  ok: boolean;
  before?: { total_drafts: number; contacts: number; duplicates: number };
  after?: { total_drafts: number; contacts: number };
  deleted?: number;
  error?: string;
}> {
  const sb = createAdminClient();

  // BEFORE snapshot — for the toast
  let beforeQuery = sb.from("sends").select("id, contact_id").eq("status", "pending_approval");
  if (opts.contactIds && opts.contactIds.length > 0) {
    beforeQuery = beforeQuery.in("contact_id", opts.contactIds);
  }
  const { data: beforeData } = await beforeQuery;
  if (!beforeData) return { ok: false, error: "Couldn't load pending drafts." };

  const before = {
    total_drafts: beforeData.length,
    contacts: new Set(beforeData.map((d: any) => d.contact_id).filter(Boolean)).size,
    duplicates: 0,
  };
  before.duplicates = before.total_drafts - before.contacts;

  if (before.duplicates === 0) {
    return { ok: true, before, after: { total_drafts: before.total_drafts, contacts: before.contacts }, deleted: 0 };
  }

  // Group drafts by contact, sort each group desc by created_at, keep first.
  // We need created_at — re-fetch with that field.
  let detailQuery = sb.from("sends").select("id, contact_id, created_at")
    .eq("status", "pending_approval");
  if (opts.contactIds && opts.contactIds.length > 0) {
    detailQuery = detailQuery.in("contact_id", opts.contactIds);
  }
  const { data: detailData } = await detailQuery;
  if (!detailData) return { ok: false, error: "Couldn't load draft details." };

  const byContact = new Map<string, any[]>();
  for (const d of detailData as any[]) {
    if (!d.contact_id) continue;
    if (!byContact.has(d.contact_id)) byContact.set(d.contact_id, []);
    byContact.get(d.contact_id)!.push(d);
  }

  const toDelete: string[] = [];
  for (const [, drafts] of byContact) {
    if (drafts.length <= 1) continue;
    // Sort by created_at descending — keep [0], delete [1..]
    drafts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    for (let i = 1; i < drafts.length; i++) toDelete.push(drafts[i].id);
  }

  if (toDelete.length === 0) {
    return { ok: true, before, after: { total_drafts: before.total_drafts, contacts: before.contacts }, deleted: 0 };
  }

  // Bulk delete in chunks (Supabase has a URL length cap on .in() filters)
  let deleted = 0;
  const CHUNK = 500;
  for (let i = 0; i < toDelete.length; i += CHUNK) {
    const chunk = toDelete.slice(i, i + CHUNK);
    const { data: del, error } = await sb.from("sends").delete().in("id", chunk).select("id");
    if (error) return { ok: false, error: `delete: ${error.message}`, before, deleted };
    deleted += del?.length ?? 0;
  }

  // AFTER snapshot
  const after = {
    total_drafts: before.total_drafts - deleted,
    contacts: before.contacts,
  };

  revalidatePath("/approve");
  revalidatePath("/sends");
  revalidatePath("/");
  return { ok: true, before, after, deleted };
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

  // CHUNKED .in() lookup. PostgREST URL limit is ~8KB. A UUID is 36 chars
  // plus comma/encoding overhead ≈ 40 chars in the URL. 200 UUIDs ≈ 8KB,
  // so 100 per chunk keeps us safely under the limit with headroom.
  // Without this chunking, "Send selected (410)" silently truncated and
  // returned 0 rows → user saw "No pending drafts to send" despite having
  // 410 valid selections.
  const SELECT_CHUNK = 100;
  let pending: any[] = [];
  if (sendIds && sendIds.length > 0) {
    for (let i = 0; i < sendIds.length; i += SELECT_CHUNK) {
      const chunk = sendIds.slice(i, i + SELECT_CHUNK);
      const { data: page, error } = await sb.from("sends")
        .select(`id, contacts(email, unsubscribed_at)`)
        .eq("status", "pending_approval")
        .in("id", chunk);
      if (error) {
        console.error(`[send] SELECT chunk ${i} failed:`, error);
        return { ok: false, error: `Lookup failed: ${error.message}` };
      }
      if (page) pending.push(...page);
    }
  } else {
    // "Send ALL pending" path — no IDs to chunk, but still need pagination
    // because Supabase caps results at 1000. Page through with .range().
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const { data: page, error } = await sb.from("sends")
        .select(`id, contacts(email, unsubscribed_at)`)
        .eq("status", "pending_approval")
        .order("id")
        .range(offset, offset + PAGE - 1);
      if (error) {
        console.error(`[send] paginated SELECT offset ${offset} failed:`, error);
        return { ok: false, error: `Lookup failed: ${error.message}` };
      }
      if (!page || page.length === 0) break;
      pending.push(...page);
      if (page.length < PAGE) break;
      offset += PAGE;
      if (offset > 100_000) break;  // sanity guard
    }
  }

  if (!pending || pending.length === 0) {
    return {
      ok: false,
      error: `No pending drafts to send. ${sendIds?.length ? `(Checked ${sendIds.length} selected IDs — none were in pending_approval state. They may have already been sent, scheduled, or skipped.)` : ""}`,
    };
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
  // audit trail of why they weren't sent. CHUNKED same as SELECT.
  const WRITE_CHUNK = 100;
  if (skipIds.length > 0) {
    for (let i = 0; i < skipIds.length; i += WRITE_CHUNK) {
      const chunk = skipIds.slice(i, i + WRITE_CHUNK);
      await sb.from("sends").update({
        status: "skipped",
        failure_reason: "Contact has no email or has unsubscribed",
      }).in("id", chunk);
      await sb.from("approvals").update({ status: "skipped" }).in("send_id", chunk);
    }
  }

  // Bulk-queue the sendable ones with scheduled_at = NOW so the cloud
  // dispatcher picks them up on its next 15-min tick. Atomic via the
  // status='pending_approval' filter — only flips drafts that haven't
  // already been claimed by something else. CHUNKED.
  let queued = 0;
  if (queueIds.length > 0) {
    for (let i = 0; i < queueIds.length; i += WRITE_CHUNK) {
      const chunk = queueIds.slice(i, i + WRITE_CHUNK);
      const { data: claimed, error } = await sb.from("sends").update({
        status: "approved",
        scheduled_at: nowIso,
      }).in("id", chunk).eq("status", "pending_approval").select("id");
      if (error) {
        console.error(`[send] UPDATE chunk ${i} failed:`, error);
        continue;  // keep going — partial success better than total failure
      }
      const claimedIds = (claimed ?? []).map((c: any) => c.id);
      queued += claimedIds.length;
      if (claimedIds.length > 0) {
        await sb.from("approvals").update({
          status: "approved", reviewed_at: nowIso,
        }).in("send_id", claimedIds);
      }
    }
  }

  // INSTANT DISPATCH: if a GitHub PAT is configured, immediately trigger
  // the dispatch-scheduled workflow so it starts firing sends within ~10s
  // instead of waiting up to 15 min for the next cron tick. Silent
  // fallback if the call fails OR the token isn't set — the cron will
  // still pick them up on its normal schedule. Either way the user's
  // queue is durable.
  let dispatcher_triggered = false;
  let dispatcher_trigger_error: string | null = null;
  const ghToken = process.env.GH_WORKFLOW_TOKEN;
  if (ghToken && queued > 0) {
    try {
      const owner = process.env.GH_REPO_OWNER ?? "Abhinavkrrr";
      const repo  = process.env.GH_REPO_NAME  ?? "apping-god";
      const ref   = process.env.GH_REPO_REF   ?? "main";
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/workflows/dispatch-scheduled.yml/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ref }),
        }
      );
      // GitHub returns 204 No Content on success
      if (res.status === 204) {
        dispatcher_triggered = true;
      } else {
        dispatcher_trigger_error = `GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`;
        console.warn("[dispatcher trigger]", dispatcher_trigger_error);
      }
    } catch (e) {
      dispatcher_trigger_error = e instanceof Error ? e.message : String(e);
      console.warn("[dispatcher trigger]", dispatcher_trigger_error);
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
    cloud_dispatched: true,            // queued for cloud dispatcher
    dispatcher_triggered,              // true if we kicked the workflow ourselves
    dispatcher_trigger_error,          // surfaced for diagnostics; UI ignores when triggered=true
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
