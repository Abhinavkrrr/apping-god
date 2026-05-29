// Drains the approved-sends queue by invoking the send-worker Edge Function.
//
// Picks sends with status='approved' whose scheduled_at <= now, respects
// daily caps, jitters between sends, and sets next_followup_at on success.
//
// Usage:
//   node scripts/dispatch_approved.js                  → drain up to 35 sends
//   node scripts/dispatch_approved.js --limit 10       → cap
//   node scripts/dispatch_approved.js --dry-run

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { getSupabase } = require("./lib/supabase");

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || "50", 10) : 50;
// Jitter window between sends (ms). Default 3-8s — still safe under Gmail's
// per-account daily/per-min throttles (free Gmail 500/day, Workspace 2000/day,
// neither cares about ~10s gaps). Override with --jitter-min / --jitter-max.
const jMinIdx = args.indexOf("--jitter-min");
const jMaxIdx = args.indexOf("--jitter-max");
const jitterMin = jMinIdx >= 0 ? parseInt(args[jMinIdx + 1] || "3000", 10) : 3000;
const jitterMax = jMaxIdx >= 0 ? parseInt(args[jMaxIdx + 1] || "8000", 10) : 8000;

const FUNCTION_URL = `https://${process.env.SUPABASE_PROJECT_REF}.functions.supabase.co/send-worker`;
const FOLLOWUP_DELAY_DAYS = 2;

(async () => {
  const sb = getSupabase();
  console.log(`Dispatcher — drain up to ${limit} approved sends. ${dry ? "(dry run)" : ""}`);

  const { data: due } = await sb.from("sends").select(`
    id, contact_id, resume_id, rendered_subject, rendered_body, sequence_step,
    contacts(email, unsubscribed_at, email_status, skip_reason)
  `)
    .eq("status", "approved")
    .lte("scheduled_at", new Date().toISOString())
    .limit(limit);

  if (!due || due.length === 0) { console.log("Nothing due."); return; }
  console.log(`Found ${due.length} due send(s)\n`);

  let sent = 0, failed = 0, skipped = 0;
  for (const send of due) {
    const c = send.contacts;

    // Defense in depth: even though bounce-handling cancels pending/approved
    // sends when a bounce is detected, we re-check here right before firing
    // because:
    //   • Race window: a bounce might land between when this send was
    //     approved and when this loop reaches it.
    //   • Stale schedules: sends scheduled before bounce detection rolled
    //     out could still be sitting in the queue.
    //   • Defense against accidentally re-imported bounced contacts.
    // Any of these checks fail → mark send as skipped (audit trail), don't fire.
    let blockReason = null;
    if (!c) blockReason = "contact_deleted";
    else if (!c.email) blockReason = "no_email";
    else if (c.unsubscribed_at) blockReason = "unsubscribed";
    else if (c.email_status === "bounced") blockReason = "previously_bounced";
    else if (c.skip_reason) blockReason = `skip_reason:${c.skip_reason}`;
    else {
      // Also check the unsubscribes table — covers bounced emails whose
      // contact row has already been deleted but where we still hold a
      // stale `approved` send pointing at the (now-null) contact_id.
      const { data: unsub } = await sb.from("unsubscribes")
        .select("email").eq("email", (c.email || "").toLowerCase()).maybeSingle();
      if (unsub) blockReason = `unsubscribes_table:${unsub.email}`;
    }

    if (blockReason) {
      console.log(`  skip ${c?.email ?? send.id}: ${blockReason}`);
      await sb.from("sends").update({
        status: "skipped",
        failure_reason: `Blocked at dispatch: ${blockReason}`,
      }).eq("id", send.id);
      await sb.from("approvals").update({ status: "skipped" }).eq("send_id", send.id);
      skipped++;
      continue;
    }

    process.stdout.write(`  ${c.email} ... `);
    if (dry) { console.log("(dry)"); sent++; continue; }

    try {
      const res = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: c.email,
          subject: send.rendered_subject,
          text_body: send.rendered_body, // worker is fine if html_body == text
          html_body: send.rendered_body,
          resume_id: send.resume_id,
          log_send_id: send.id,
        }),
      });
      const out = await res.json();
      if (res.ok && out.ok) {
        const next = new Date(Date.now() + FOLLOWUP_DELAY_DAYS * 86400_000).toISOString();
        await sb.from("sends").update({ next_followup_at: next }).eq("id", send.id);
        console.log("✓");
        sent++;
      } else {
        console.log(`✗ ${out.error || res.status}`);
        await sb.from("sends").update({ status: "failed", failure_reason: out.error || `HTTP ${res.status}` }).eq("id", send.id);
        failed++;
      }
    } catch (e) {
      console.log(`✗ ${e.message}`);
      failed++;
    }
    // Configurable jitter between sends (default 3-8s)
    if (!dry) {
      const wait = jitterMin + Math.random() * Math.max(0, jitterMax - jitterMin);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  console.log(`\nDone. sent=${sent} failed=${failed} skipped=${skipped} (jitter=${jitterMin}-${jitterMax}ms)`);
})();
