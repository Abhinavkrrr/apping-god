// Deletes ALL pending_approval drafts for the SaaS Sales campaign,
// plus their corresponding approvals rows. Leaves sent / approved /
// failed rows untouched (there are none right now, but future-proofs).
//
//   node scripts/purge_saas_pending.js [--dry-run]

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

const dryRun = process.argv.includes("--dry-run");

const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com", port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
};

(async () => {
  const c = new Client(POOLER);
  await c.connect();

  const { rows: ids } = await c.query(`
    SELECT s.id
    FROM sends s
    JOIN campaigns ca ON ca.id = s.campaign_id
    WHERE ca.name = 'SaaS Sales' AND s.status = 'pending_approval'
  `);
  console.log(`Found ${ids.length} pending SaaS Sales draft(s).`);
  if (ids.length === 0) { await c.end(); return; }

  if (dryRun) {
    console.log("DRY RUN — nothing deleted.");
    await c.end();
    return;
  }

  const idArr = ids.map(r => r.id);
  await c.query("BEGIN");
  const a = await c.query("DELETE FROM approvals WHERE send_id = ANY($1::uuid[])", [idArr]);
  const s = await c.query("DELETE FROM sends WHERE id = ANY($1::uuid[])", [idArr]);
  await c.query("COMMIT");
  console.log(`✓ Deleted ${a.rowCount} approval rows + ${s.rowCount} send rows.`);

  await c.end();
})();
