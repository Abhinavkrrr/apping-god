// Fresh-start the analytics dashboard. Wipes the audit-log tables
// (events / replies / bounces) and clears the sent_at timestamp on
// historical sent rows so the time-series charts read empty — BUT
// keeps sends.status='sent' rows so dedup still works (already-mailed
// contacts won't reappear in the Approve queue on the next Generate).
//
//   node scripts/reset_analytics.js --dry-run     # preview, don't write
//   node scripts/reset_analytics.js               # actually reset
//   node scripts/reset_analytics.js --keep-timeline  # wipe analytics tables but keep historical sent_at bars
//   node scripts/reset_analytics.js --full        # also delete failed/skipped sends (full pipeline reset)
//
// After running, refresh /analytics: KPI tiles reset to 0 across the
// board, timeline empties, but the next time you click Generate the
// dedup will still skip every contact you've already mailed.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

const dryRun        = process.argv.includes("--dry-run");
const keepTimeline  = process.argv.includes("--keep-timeline");
const full          = process.argv.includes("--full");

const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com", port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
};

async function tableExists(c, name) {
  const { rows } = await c.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
    [name]
  );
  return rows.length > 0;
}

async function count(c, table, where = "") {
  if (!await tableExists(c, table)) return null;
  const { rows } = await c.query(`SELECT count(*) AS n FROM ${table}${where ? " WHERE " + where : ""}`);
  return parseInt(rows[0].n, 10);
}

(async () => {
  const c = new Client(POOLER);
  await c.connect();
  console.log(`Connected to Supabase pooler. Mode: ${dryRun ? "DRY-RUN" : "EXECUTE"}${keepTimeline ? " · keep-timeline" : ""}${full ? " · full" : ""}\n`);

  // ── BEFORE snapshot ─────────────────────────────────────────────
  const before = {
    events:                await count(c, "events"),
    replies:               await count(c, "replies"),
    bounces:               await count(c, "bounces"),
    sends_total:           await count(c, "sends"),
    sends_sent:            await count(c, "sends", "status='sent'"),
    sends_pending_approval:await count(c, "sends", "status='pending_approval'"),
    sends_approved:        await count(c, "sends", "status='approved'"),
    sends_failed:          await count(c, "sends", "status='failed'"),
    sends_skipped:         await count(c, "sends", "status='skipped'"),
    sends_with_sent_at:    await count(c, "sends", "sent_at IS NOT NULL"),
    contacts:              await count(c, "contacts"),
    contacts_bounced:      await count(c, "contacts", "skip_reason IN ('hard_bounce','soft_bounce')"),
  };
  console.log("── BEFORE ──");
  console.table(before);

  // ── Plan ────────────────────────────────────────────────────────
  const plan = [];
  if (before.events  !== null && before.events  > 0) plan.push(`DELETE ${before.events} rows from events`);
  if (before.replies !== null && before.replies > 0) plan.push(`DELETE ${before.replies} rows from replies`);
  if (before.bounces !== null && before.bounces > 0) plan.push(`DELETE ${before.bounces} rows from bounces`);
  if (!keepTimeline && before.sends_with_sent_at > 0) {
    plan.push(`NULL sent_at on ${before.sends_with_sent_at} historical sends (status='sent' rows stay, dedup unaffected)`);
  }
  if (full) {
    if (before.sends_failed  > 0) plan.push(`DELETE ${before.sends_failed} failed sends`);
    if (before.sends_skipped > 0) plan.push(`DELETE ${before.sends_skipped} skipped sends`);
  }
  plan.push(`RESET accounts.sent_today = 0 + accounts.last_reset_date = today`);

  console.log("\n── PLAN ──");
  plan.forEach((p, i) => console.log(`  ${i+1}. ${p}`));

  console.log("\n── KEPT (untouched) ──");
  console.log(`  • ${before.contacts} contacts (all preserved)`);
  console.log(`  • ${before.sends_sent} 'sent' status rows (dedup keeps already-mailed contacts out of Approve)`);
  console.log(`  • ${before.sends_pending_approval} pending drafts (your current Approve queue stays as-is)`);
  console.log(`  • ${before.sends_approved} scheduled sends (will still fire at their scheduled time)`);
  console.log(`  • ${before.contacts_bounced} bounce-blocked contacts (skip_reason preserved so the agent still won't mail dead addresses)`);
  console.log(`  • All import_batches, templates, sequences, campaigns, resumes, accounts (credentials)`);

  if (dryRun) {
    console.log("\nDRY-RUN — no writes. Re-run without --dry-run to execute.");
    await c.end();
    return;
  }

  // ── EXECUTE ─────────────────────────────────────────────────────
  console.log("\n── EXECUTING ──");
  await c.query("BEGIN");
  try {
    if (await tableExists(c, "events"))  { const r = await c.query("DELETE FROM events");  console.log(`  ✓ events  : ${r.rowCount} deleted`); }
    if (await tableExists(c, "replies")) { const r = await c.query("DELETE FROM replies"); console.log(`  ✓ replies : ${r.rowCount} deleted`); }
    if (await tableExists(c, "bounces")) { const r = await c.query("DELETE FROM bounces"); console.log(`  ✓ bounces : ${r.rowCount} deleted`); }

    if (!keepTimeline) {
      const r = await c.query("UPDATE sends SET sent_at = NULL WHERE sent_at IS NOT NULL");
      console.log(`  ✓ sends.sent_at nulled: ${r.rowCount} rows (status='sent' preserved → dedup still active)`);
    }

    if (full) {
      const rf = await c.query("DELETE FROM sends WHERE status IN ('failed','skipped')");
      console.log(`  ✓ failed+skipped sends deleted: ${rf.rowCount}`);
    }

    // Reset per-account daily counter so tomorrow morning's quota is fresh
    const ra = await c.query(`
      UPDATE accounts
      SET sent_today = 0, last_reset_date = CURRENT_DATE
      WHERE sent_today > 0 OR last_reset_date IS NULL OR last_reset_date < CURRENT_DATE
    `);
    console.log(`  ✓ accounts.sent_today reset: ${ra.rowCount} accounts`);

    await c.query("COMMIT");
    console.log("\n✓ COMMITTED.");
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("\n✗ ROLLED BACK:", e.message);
    process.exit(1);
  }

  // ── AFTER snapshot ──────────────────────────────────────────────
  const after = {
    events:             await count(c, "events"),
    replies:            await count(c, "replies"),
    bounces:            await count(c, "bounces"),
    sends_total:        await count(c, "sends"),
    sends_sent:         await count(c, "sends", "status='sent'"),
    sends_with_sent_at: await count(c, "sends", "sent_at IS NOT NULL"),
  };
  console.log("\n── AFTER ──");
  console.table(after);

  console.log("\n✓ Analytics is fresh. Refresh /analytics to confirm zeros across the board.");
  console.log("  Your Approve queue + scheduled sends + bounce blocks are untouched.");
  console.log("  Next Generate will skip already-mailed contacts via the preserved sends rows.");
  await c.end();
})();
