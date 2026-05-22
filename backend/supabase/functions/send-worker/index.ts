// Send worker — invoked by scheduler. Picks the next healthy Gmail account,
// renders the template + LLM personalization, attaches resume, SMTP send,
// logs event(sent), schedules follow-up.
//
// Phase 1 stub: returns 200 with a noop. Phase 2 implements full send.

import { admin, corsHeaders } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const sendId = body?.send_id;

  if (!sendId) {
    return new Response(JSON.stringify({ error: "missing send_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = admin();
  const { data: send } = await sb.from("sends").select("*").eq("id", sendId).single();

  return new Response(
    JSON.stringify({
      ok: true,
      send_id: sendId,
      will_send_to_contact_id: send?.contact_id,
      phase: "Phase 1 stub — SMTP send lands in Phase 2 (nodemailer via Supabase Edge)",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
