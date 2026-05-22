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
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || "35", 10) : 35;

const FUNCTION_URL = `https://${process.env.SUPABASE_PROJECT_REF}.functions.supabase.co/send-worker`;
const FOLLOWUP_DELAY_DAYS = 2;

(async () => {
  const sb = getSupabase();
  console.log(`Dispatcher — drain up to ${limit} approved sends. ${dry ? "(dry run)" : ""}`);

  const { data: due } = await sb.from("sends").select(`
    id, contact_id, resume_id, rendered_subject, rendered_body, sequence_step,
    contacts(email, unsubscribed_at)
  `)
    .eq("status", "approved")
    .lte("scheduled_at", new Date().toISOString())
    .limit(limit);

  if (!due || due.length === 0) { console.log("Nothing due."); return; }
  console.log(`Found ${due.length} due send(s)\n`);

  let sent = 0, failed = 0, skipped = 0;
  for (const send of due) {
    const c = send.contacts;
    if (!c?.email) { console.log(`  skip ${send.id}: no contact email`); skipped++; continue; }
    if (c.unsubscribed_at) { console.log(`  skip ${c.email}: unsubscribed`); skipped++; continue; }

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
    // Jitter 5-15 seconds between sends to look human
    if (!dry) await new Promise(r => setTimeout(r, 5000 + Math.random() * 10000));
  }
  console.log(`\nDone. sent=${sent} failed=${failed} skipped=${skipped}`);
})();
