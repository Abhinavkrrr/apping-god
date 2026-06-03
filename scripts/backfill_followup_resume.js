// One-shot backfill: attach the campaign's resume_id to every existing
// follow-up send (sequence_step > 0) that's currently resume_id=NULL.
//
// Run once after deploying the followup-daemon update so the drafts
// already in the queue (generated before the change) also get the CV.
//
//   node scripts/backfill_followup_resume.js [--dry-run]

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
  console.log(`${dry ? "[DRY-RUN] " : ""}Scanning follow-up sends with no resume_id…`);

  // Find affected rows
  const { rows: preview } = await c.query(`
    SELECT s.id AS send_id, s.sequence_step, s.status,
           ca.name AS campaign, ca.resume_id AS campaign_resume_id
    FROM sends s
    JOIN campaigns ca ON ca.id = s.campaign_id
    WHERE s.sequence_step > 0
      AND s.resume_id IS NULL
      AND ca.resume_id IS NOT NULL
      AND s.status IN ('pending_approval', 'approved')
    ORDER BY ca.name, s.sequence_step;
  `);

  console.log(`\nFound ${preview.length} follow-up send(s) to backfill.\n`);

  // Group by campaign for a friendly summary
  const byCampaign = new Map();
  for (const r of preview) {
    const k = r.campaign;
    if (!byCampaign.has(k)) byCampaign.set(k, []);
    byCampaign.get(k).push(r);
  }
  for (const [name, rows] of byCampaign) {
    const byStep = rows.reduce((acc, r) => {
      acc[r.sequence_step] = (acc[r.sequence_step] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`  ${name}:`, byStep);
  }

  if (preview.length === 0 || dry) {
    if (dry) console.log("\nDRY-RUN — no writes. Re-run without --dry-run to execute.");
    await c.end();
    return;
  }

  // Perform the backfill — one UPDATE per campaign so each follow-up
  // gets its OWN campaign's resume, not someone else's.
  let updated = 0;
  for (const [campaignName, rows] of byCampaign) {
    const campaignResumeId = rows[0].campaign_resume_id;
    const r = await c.query(`
      UPDATE sends s
      SET resume_id = $1
      FROM campaigns ca
      WHERE ca.id = s.campaign_id
        AND ca.name = $2
        AND s.sequence_step > 0
        AND s.resume_id IS NULL
        AND s.status IN ('pending_approval', 'approved')
      RETURNING s.id;
    `, [campaignResumeId, campaignName]);
    updated += r.rowCount;
    console.log(`  ✓ ${campaignName}: backfilled ${r.rowCount} send(s) with resume ${campaignResumeId}`);
  }

  console.log(`\n✓ Done. Total follow-ups updated: ${updated}`);
  await c.end();
})();
