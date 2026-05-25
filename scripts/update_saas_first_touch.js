// Updates the live SaaS Sales first-touch template body in the DB and
// rewrites any pending_approval drafts that were rendered from it so the
// new copy shows up in the Approve queue without manually regenerating.
//
// Safe to run multiple times — the regex-replace on rendered_body only
// matches the old line; subsequent runs are no-ops.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com", port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
};

const OLD_LINE_RAW =
  "A comparable team I shipped this for saw response time drop from **8 hours → 4 minutes**, and effectively replaced one SDR seat in the first month.";
const NEW_LINE_RAW =
  "A comparable team I shipped this for cut response time from **8 hours → 4 minutes** — their support team stopped drowning in tier-1 tickets, and their sales reps stopped spending half their week hunting for leads.";

// Rendered drafts have **bold** already converted to <strong>bold</strong>.
const OLD_LINE_HTML =
  "A comparable team I shipped this for saw response time drop from <strong>8 hours → 4 minutes</strong>, and effectively replaced one SDR seat in the first month.";
const NEW_LINE_HTML =
  "A comparable team I shipped this for cut response time from <strong>8 hours → 4 minutes</strong> — their support team stopped drowning in tier-1 tickets, and their sales reps stopped spending half their week hunting for leads.";

(async () => {
  const c = new Client(POOLER);
  await c.connect();
  console.log("Connected.");

  // 1. Find the SaaS Sales first-touch template
  const { rows: tpls } = await c.query(`
    SELECT t.id, t.body_tmpl
    FROM templates t
    JOIN sequences s ON s.template_id = t.id
    JOIN campaigns ca ON ca.id = s.campaign_id
    WHERE ca.name = 'SaaS Sales' AND s.step_number = 0
  `);
  if (tpls.length === 0) {
    console.error("✗ No SaaS Sales first-touch template found.");
    process.exit(1);
  }
  const tpl = tpls[0];

  // 2. Replace the line in body_tmpl
  if (!tpl.body_tmpl.includes(OLD_LINE_RAW)) {
    console.log("  · Template body already updated (or differs from expected). No change.");
  } else {
    const newBody = tpl.body_tmpl.replace(OLD_LINE_RAW, NEW_LINE_RAW);
    await c.query("UPDATE templates SET body_tmpl = $1 WHERE id = $2", [newBody, tpl.id]);
    console.log("  ✓ Updated templates.body_tmpl");
  }

  // 3. Re-render any pending drafts that used this template
  const rendered = await c.query(`
    UPDATE sends
       SET rendered_body = REPLACE(rendered_body, $1, $2)
     WHERE template_id = $3
       AND status = 'pending_approval'
       AND rendered_body LIKE '%SDR seat in the first month%'
    RETURNING id
  `, [OLD_LINE_HTML, NEW_LINE_HTML, tpl.id]);
  console.log(`  ✓ Re-rendered ${rendered.rowCount} pending draft(s)`);

  await c.end();
  console.log("Done.");
})();
