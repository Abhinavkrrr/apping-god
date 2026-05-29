// Followup daemon — generates the next follow-up send when due.
//
// Schedule: every 15 min via pg_cron.
// Behavior: for each send with next_followup_at <= now AND no reply AND
//           sequence_step < 3, generate the next follow-up draft as a
//           new sends row (status='approved', scheduled to next send window).
//           The dispatcher then sends it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TRACKING_BASE_URL = (Deno.env.get("TRACKING_BASE_URL") ?? "").replace(/\/$/, "");
const SENDER_ADDR = Deno.env.get("SENDER_PHYSICAL_ADDRESS") ?? "IIT Bombay, Mumbai, India";
const IIT_LOGO_URL = Deno.env.get("IIT_LOGO_URL") ?? "";
const FOLLOWUP_GAP_DAYS = 2;

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function renderMustache(tmpl: string, ctx: Record<string, string>): string {
  return tmpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => ctx[k] ?? "");
}

/** Mirror frontend/scripts plainToTrackedHtml so follow-ups have a tracking pixel. */
function plainToTrackedHtml(plainBody: string, sendId: string): string {
  const escaped = plainBody
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const trackBase = TRACKING_BASE_URL;
  const trackClick = (url: string) =>
    `${trackBase}/t/click/${sendId}?u=${encodeURIComponent(url)}`;
  const mdLinked = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text, url) =>
      `<a href="${trackClick(url)}" style="color:#0366d6;text-decoration:underline">${text}</a>`,
  );
  const linked = mdLinked.replace(
    /(?<!["'>])(https?:\/\/[^\s<>"]+)/g,
    (url) => `<a href="${trackClick(url)}" style="color:#0366d6">${url}</a>`,
  );
  const bolded = linked.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  const withBreaks = bolded.replace(/\n/g, "<br>\n");
  const logoBlock = IIT_LOGO_URL
    ? `<br><br><img src="${IIT_LOGO_URL}" alt="IIT Bombay" style="display:block;border:0;margin-top:8px;max-width:120px;height:auto" />`
    : "";
  const pixel = trackBase
    ? `<img src="${trackBase}/t/open/${sendId}.gif" width="1" height="1" alt="" style="display:block;border:0" />`
    : "";
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${withBreaks}${logoBlock}${pixel}</div>`;
}

Deno.serve(async () => {
  const sb = admin();
  const now = new Date();

  // Find due follow-ups
  const { data: due } = await sb.from("sends").select(`
    id, contact_id, campaign_id, sequence_step, thread_id, message_id,
    contacts(first_name, email, unsubscribed_at, email_status, skip_reason, companies(name, brief_one_line))
  `)
    .lte("next_followup_at", now.toISOString())
    .lt("sequence_step", 3)
    .eq("status", "sent")
    .limit(100);

  let created = 0, skipped = 0;
  for (const send of due ?? []) {
    const c = (send as any).contacts;
    // Skip if contact was deleted (e.g., bounced and removed), has no email,
    // unsubscribed, was marked bounced, or has any skip_reason set. This
    // prevents follow-ups from going out to addresses that bounced on the
    // first send.
    if (!c) { skipped++; continue; }
    if (!c.email || c.unsubscribed_at) { skipped++; continue; }
    if (c.email_status === "bounced" || c.skip_reason) { skipped++; continue; }

    // Also check the unsubscribes table in case the bounce flow removed the
    // contact but left a stale send pointer with a now-null contact reference.
    const { data: unsub } = await sb.from("unsubscribes")
      .select("email").eq("email", (c.email ?? "").toLowerCase()).maybeSingle();
    if (unsub) { skipped++; continue; }

    // Atomically CLAIM this row by clearing next_followup_at — if another
    // concurrent run already grabbed it, our update affects 0 rows and we skip.
    const { data: claimed, error: claimErr } = await sb.from("sends")
      .update({ next_followup_at: null })
      .eq("id", send.id)
      .lte("next_followup_at", now.toISOString())
      .select("id");
    if (claimErr || !claimed || claimed.length === 0) { skipped++; continue; }

    // Check no reply (after claim, since reply might have arrived)
    const { count: replyCount } = await sb.from("replies")
      .select("id", { count: "exact", head: true }).eq("send_id", send.id);
    if ((replyCount ?? 0) > 0) { skipped++; continue; }

    const nextStep = send.sequence_step + 1;
    if (nextStep > 3) { skipped++; continue; }

    const { data: seq } = await sb.from("sequences").select("*, templates(*)")
      .eq("campaign_id", send.campaign_id).eq("step_number", nextStep).single();
    if (!seq) { skipped++; continue; }
    const t = (seq as any).templates;

    const company = c.companies || { name: "your company", brief_one_line: "" };
    const ctx = {
      first_name: c.first_name ?? "",
      company: company.name ?? "",
      company_brief_one_line: company.brief_one_line ?? "",
    };
    const subject = renderMustache(t.subject_tmpl, ctx);
    const textBody = renderMustache(t.body_tmpl, ctx);

    // Pre-allocate UUID so the tracking pixel can reference the right send row.
    const newSendId = crypto.randomUUID();
    const html = plainToTrackedHtml(textBody, newSendId);

    const { error } = await sb.from("sends").insert({
      id: newSendId,
      contact_id: send.contact_id,
      campaign_id: send.campaign_id,
      sequence_step: nextStep,
      template_id: t.id,
      resume_id: null, // follow-ups don't re-attach
      rendered_subject: subject,
      rendered_body: html,
      status: "approved",
      scheduled_at: now.toISOString(),
      // Fallback chain: parent's thread_id, or parent's message_id (first follow-up).
      thread_id: send.thread_id ?? send.message_id,
    });
    if (!error) created++;
    else skipped++;
  }

  return new Response(JSON.stringify({
    ok: true, due_count: due?.length ?? 0, created, skipped,
    timestamp: now.toISOString(),
  }), { headers: { "Content-Type": "application/json" } });
});
