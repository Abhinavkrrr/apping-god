// Diagnoses the pending_approval count: breaks it down by campaign + status,
// counts distinct contacts touched, and surfaces any over-touched contacts
// (same contact with drafts in multiple campaigns).

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com", port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
};

(async () => {
  const c = new Client(POOLER);
  await c.connect();

  // 1) Total contacts in DB
  const contacts = await c.query(`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE unsubscribed_at IS NULL AND skip_reason IS NULL) AS eligible
    FROM contacts
  `);
  console.log("\n── CONTACTS ──");
  console.table(contacts.rows);

  // 2) sends breakdown by campaign + status
  const byCampaign = await c.query(`
    SELECT ca.name AS campaign, s.status, count(*) AS n
    FROM sends s
    JOIN campaigns ca ON ca.id = s.campaign_id
    GROUP BY ca.name, s.status
    ORDER BY ca.name, s.status
  `);
  console.log("\n── SENDS by campaign × status ──");
  console.table(byCampaign.rows);

  // 3) Pending only, by campaign
  const pending = await c.query(`
    SELECT ca.name AS campaign, count(*) AS pending
    FROM sends s
    JOIN campaigns ca ON ca.id = s.campaign_id
    WHERE s.status = 'pending_approval'
    GROUP BY ca.name
    ORDER BY pending DESC
  `);
  console.log("\n── PENDING by campaign ──");
  console.table(pending.rows);

  // 4) Distinct contacts in pending pile
  const distinct = await c.query(`
    SELECT count(DISTINCT contact_id) AS distinct_contacts
    FROM sends WHERE status = 'pending_approval'
  `);
  console.log("\n── DISTINCT contacts in pending ──");
  console.table(distinct.rows);

  // 5) Contacts that have a draft in MORE than one campaign
  const multi = await c.query(`
    SELECT contact_id, count(DISTINCT campaign_id) AS campaigns_touched
    FROM sends WHERE status = 'pending_approval'
    GROUP BY contact_id HAVING count(DISTINCT campaign_id) > 1
  `);
  console.log(`\n── Contacts pending in >1 campaign: ${multi.rowCount} ──`);

  await c.end();
})();
