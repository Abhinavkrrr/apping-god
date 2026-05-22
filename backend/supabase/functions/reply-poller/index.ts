// Reply poller — runs every 2 min via pg_cron.
// Connects to each active Gmail account's IMAP, fetches new messages since
// last_uid, matches to sends via In-Reply-To header, classifies via Groq,
// updates sequence (STOP / PAUSE).
//
// Phase 1 stub.

import { admin, corsHeaders } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = admin();
  const { data: accounts } = await sb
    .from("accounts")
    .select("id, email, imap_last_uid")
    .in("warmup_phase", ["warmup", "active"]);

  return new Response(
    JSON.stringify({
      ok: true,
      account_count: accounts?.length ?? 0,
      phase: "Phase 1 stub — IMAP polling + classification lands in Phase 4",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
