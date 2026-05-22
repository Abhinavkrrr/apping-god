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
const FOLLOWUP_GAP_DAYS = 2;

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function renderMustache(tmpl: string, ctx: Record<string, string>): string {
  return tmpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => ctx[k] ?? "");
}

Deno.serve(async () => {
  const sb = admin();
  const now = new Date();

  // Find due follow-ups
  const { data: due } = await sb.from("sends").select(`
    id, contact_id, campaign_id, sequence_step, thread_id, message_id,
    contacts(first_name, email, unsubscribed_at, companies(name, brief_one_line))
  `)
    .lte("next_followup_at", now.toISOString())
    .lt("sequence_step", 3)
    .eq("status", "sent")
    .limit(100);

  let created = 0, skipped = 0;
  for (const send of due ?? []) {
    const c = (send as any).contacts;
    if (!c?.email || c?.unsubscribed_at) { skipped++; continue; }

    // Check no reply
    const { count: replyCount } = await sb.from("replies")
      .select("id", { count: "exact", head: true }).eq("send_id", send.id);
    if ((replyCount ?? 0) > 0) {
      // Clear next_followup_at so we don't reconsider
      await sb.from("sends").update({ next_followup_at: null }).eq("id", send.id);
      skipped++; continue;
    }

    const nextStep = send.sequence_step + 1;

    // Next template
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
    const body = renderMustache(t.body_tmpl, ctx);

    const { error } = await sb.from("sends").insert({
      contact_id: send.contact_id,
      campaign_id: send.campaign_id,
      sequence_step: nextStep,
      template_id: t.id,
      resume_id: null, // follow-ups don't re-attach
      rendered_subject: subject,
      rendered_body: body,
      status: "approved",
      scheduled_at: now.toISOString(),
      thread_id: send.thread_id,
    });
    if (!error) {
      // Clear next_followup_at on parent
      await sb.from("sends").update({ next_followup_at: null }).eq("id", send.id);
      created++;
    } else { skipped++; }
  }

  return new Response(JSON.stringify({
    ok: true, due_count: due?.length ?? 0, created, skipped,
    timestamp: now.toISOString(),
  }), { headers: { "Content-Type": "application/json" } });
});
