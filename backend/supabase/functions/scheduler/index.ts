// Scheduler — runs every minute via pg_cron.
// Picks approved sends ready to fire, respects per-account daily caps,
// and dispatches them to the send-worker function.
//
// Wiring (after Phase 1):
//   SELECT cron.schedule('scheduler', '* * * * *',
//     $$ SELECT net.http_post(
//          url:='https://<ref>.functions.supabase.co/scheduler',
//          headers:='{"Authorization": "Bearer <SERVICE_ROLE>"}'::jsonb
//        ); $$);

import { admin, corsHeaders } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = admin();
  const now = new Date().toISOString();

  // Find approved sends due now
  const { data: due, error } = await sb
    .from("sends")
    .select("id, contact_id, account_id, campaign_id")
    .eq("status", "approved")
    .lte("scheduled_at", now)
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // TODO Phase 2: respect account caps + dispatch to send-worker
  // For Phase 1, just report.
  return new Response(
    JSON.stringify({
      ok: true,
      candidate_count: due?.length ?? 0,
      timestamp: now,
      phase: "Phase 1 stub — dispatch wiring lands in Phase 2",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
