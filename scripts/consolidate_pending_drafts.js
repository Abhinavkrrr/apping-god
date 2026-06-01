// Collapse the pending draft queue to 1 draft per contact.
// For each contact that has > 1 pending_approval draft (i.e., they've been
// generated in multiple campaigns), keep the MOST RECENT one and delete
// the rest. ON DELETE CASCADE on approvals.send_id auto-cleans approval
// rows so we only need to touch the sends table.
//
//   node scripts/consolidate_pending_drafts.js --dry-run    # preview only
//   node scripts/consolidate_pending_drafts.js              # execute

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

const dry = process.argv.includes("--dry-run");

const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com", port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
};

(async () => {
  const c = new Client(POOLER);
  await c.connect();
  console.log(`${dry ? "[DRY-RUN] " : ""}Scanning pending drafts for duplicates per contact…\n`);

  // BEFORE snapshot
  const before = await c.query(`
    SELECT
      count(*) AS total_pending_drafts,
      count(DISTINCT contact_id) AS distinct_contacts_with_pending,
      count(*) - count(DISTINCT contact_id) AS duplicates_to_delete
    FROM sends WHERE status = 'pending_approval'
  `);
  console.log("── BEFORE ──");
  console.table(before.rows);

  // Per-campaign breakdown
  const byCampaign = await c.query(`
    SELECT ca.name AS campaign, count(*) AS pending_drafts
    FROM sends s JOIN campaigns ca ON ca.id = s.campaign_id
    WHERE s.status = 'pending_approval'
    GROUP BY ca.name ORDER BY count(*) DESC
  `);
  console.log("\n── Per-campaign pending ──");
  console.table(byCampaign.rows);

  if (parseInt(before.rows[0].duplicates_to_delete) === 0) {
    console.log("\n✓ Already 1 draft per contact. Nothing to do.");
    await c.end();
    return;
  }

  if (dry) {
    console.log(`\nWould delete ${before.rows[0].duplicates_to_delete} duplicate draft(s) (keeping most recent per contact).`);
    console.log("Re-run without --dry-run to execute.");
    await c.end();
    return;
  }

  // Execute: ranked window keeps rn=1 (most recent), deletes rn>1.
  // approvals.send_id is ON DELETE CASCADE so we only touch sends.
  const result = await c.query(`
    WITH ranked AS (
      SELECT id,
             row_number() OVER (PARTITION BY contact_id ORDER BY created_at DESC) AS rn
      FROM sends
      WHERE status = 'pending_approval'
    )
    DELETE FROM sends
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    RETURNING id, contact_id, campaign_id
  `);
  console.log(`\n✓ Deleted ${result.rowCount} duplicate draft(s).`);

  // AFTER snapshot
  const after = await c.query(`
    SELECT
      count(*) AS total_pending_drafts,
      count(DISTINCT contact_id) AS distinct_contacts_with_pending,
      count(*) - count(DISTINCT contact_id) AS duplicates_remaining
    FROM sends WHERE status = 'pending_approval'
  `);
  console.log("\n── AFTER ──");
  console.table(after.rows);

  await c.end();
  console.log("\nRefresh /approve — Select all should now match the chip count.");
})();
