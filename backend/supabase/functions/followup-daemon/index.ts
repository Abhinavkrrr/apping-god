// Follow-up daemon — runs every 15 min via pg_cron.
// Finds sends where next_followup_at <= now, no reply, sequence_step < 3.
// Generates next follow-up send (in-thread).
//
// Phase 1 stub.

import { admin, corsHeaders } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = admin();
  const now = new Date().toISOString();

  const { data: due } = await sb
    .from("sends")
    .select("id, sequence_step")
    .lte("next_followup_at", now)
    .lt("sequence_step", 3)
    .limit(100);

  return new Response(
    JSON.stringify({
      ok: true,
      due_count: due?.length ?? 0,
      timestamp: now,
      phase: "Phase 1 stub — follow-up generation lands in Phase 4",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
