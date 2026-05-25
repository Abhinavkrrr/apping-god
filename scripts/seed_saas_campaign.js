// Creates a SECOND campaign called 'SaaS Sales' alongside the existing
// 'Outreach' campaign. Seeds 4 templates (first-touch + 3 follow-ups)
// pitched at selling AI agents to B2B teams.
//
// Idempotent — safe to re-run. Won't duplicate the campaign or overwrite
// existing templates unless --reset is passed.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

const reset = process.argv.includes("--reset");
const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com", port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
};

const SUBJECT_TMPL =
  "AI agents for {{company}} — 2-min demo?";

const FIRST_TOUCH_BODY = `Hi {{first_name}},

I'm building **AI agents for B2B teams** and noticed {{company}} is
{{company_brief_one_line}}

Two things I think would pay back the first week:

• **AI Sales Agent** — qualifies inbound leads from your website/inbox 24×7, books meetings into your calendar, learns your ICP in 1 day.
• **AI Support Agent** — auto-resolves **60–70%** of repetitive tickets after training on your help docs in <24 hours.

A comparable team I shipped this for cut response time from **8 hours → 4 minutes** — their support team stopped drowning in tier-1 tickets, and their sales reps stopped spending half their week hunting for leads.

Open to a **2-minute Loom** showing exactly what we'd build for {{company}}? No pitch deck — just the actual product walking through your use case.

Best,
**Abhinav Kumar**
+91 6201395251 | [LinkedIn](https://www.linkedin.com/in/abhinav-kumar-499004280/)
IIT Bombay | Class of 2027`;

const FOLLOWUP_1_BODY = `Hi {{first_name}},

Just floating my note back to the top of your inbox.

If a 2-min Loom on **AI agents for {{company}}** isn't the right fit — totally fine. But if you're at all curious about either the sales-agent or support-agent side, I can ship a demo against your own data within 48 hours.

Best,
**Abhinav**`;

const FOLLOWUP_2_BODY = `Hi {{first_name}},

One more nudge — promise this is the second-last.

The reason I keep reaching out: most teams I talk to *think* AI agents are 6-month integrations. We've got the build-to-demo down to **2 days** for sales and support workflows. Worth 2 minutes to find out if it applies?

Best,
**Abhinav**`;

const FOLLOWUP_3_BODY = `Hi {{first_name}},

Closing the loop here. If AI agents for **{{company}}**'s sales or support ever moves up the priority list, my inbox is open.

Wishing you and the team continued growth.

Best,
**Abhinav Kumar**
+91 6201395251 | [LinkedIn](https://www.linkedin.com/in/abhinav-kumar-499004280/)`;

const STEPS = [
  { step: 0, body: FIRST_TOUCH_BODY, is_followup: false, delay: 0, variant: "default" },
  { step: 1, body: FOLLOWUP_1_BODY, is_followup: true, delay: 2, variant: "followup-1" },
  { step: 2, body: FOLLOWUP_2_BODY, is_followup: true, delay: 2, variant: "followup-2" },
  { step: 3, body: FOLLOWUP_3_BODY, is_followup: true, delay: 2, variant: "followup-3" },
];

(async () => {
  const c = new Client(POOLER);
  await c.connect();
  console.log("Connected.");

  // 1. Create or find the campaign
  let { rows } = await c.query(
    "SELECT id, resume_id FROM campaigns WHERE name = 'SaaS Sales'"
  );
  let campaignId;
  if (rows.length === 0) {
    const ins = await c.query(`
      INSERT INTO campaigns
        (name, target_role, status, send_window_local_hour, send_window_local_minute, send_days)
      VALUES
        ('SaaS Sales', 'AI Agents for B2B teams', 'active', 10, 30, ARRAY[1,2,3,4,5])
      RETURNING id, resume_id
    `);
    campaignId = ins.rows[0].id;
    console.log("  ✓ Created campaign 'SaaS Sales' (active)");
  } else {
    campaignId = rows[0].id;
    if (reset) {
      console.log("  ↻ Reset flag set — wiping existing templates + sequences");
      await c.query("DELETE FROM sequences WHERE campaign_id = $1", [campaignId]);
      await c.query("DELETE FROM templates WHERE campaign_id = $1", [campaignId]);
    } else {
      console.log("  · Campaign exists. Use --reset to overwrite templates.");
    }
  }

  // 2. Insert templates + sequence steps
  const fSubject = `Re: ${SUBJECT_TMPL}`;
  let inserted = 0;
  for (const s of STEPS) {
    // Skip if a template at this step already exists for this campaign
    const existing = await c.query(
      `SELECT t.id FROM sequences sq JOIN templates t ON t.id = sq.template_id
       WHERE sq.campaign_id = $1 AND sq.step_number = $2`,
      [campaignId, s.step]
    );
    if (existing.rows.length > 0 && !reset) {
      console.log(`  · step ${s.step} already wired — skip`);
      continue;
    }

    const tplRes = await c.query(`
      INSERT INTO templates
        (campaign_id, variant_label, subject_tmpl, body_tmpl,
         personalization_level, is_followup, followup_step)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      campaignId,
      s.variant,
      s.is_followup ? fSubject : SUBJECT_TMPL,
      s.body,
      s.is_followup ? "light" : "medium",
      s.is_followup,
      s.is_followup ? s.step : null,
    ]);

    await c.query(`
      INSERT INTO sequences (campaign_id, step_number, template_id, delay_days)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (campaign_id, step_number) DO UPDATE SET template_id = EXCLUDED.template_id
    `, [campaignId, s.step, tplRes.rows[0].id, s.delay]);

    inserted++;
    console.log(`  ✓ step ${s.step} (${s.variant})`);
  }

  // Final state
  const final = await c.query(`
    SELECT ca.name, ca.status, count(t.id) AS templates
    FROM campaigns ca
    LEFT JOIN templates t ON t.campaign_id = ca.id
    WHERE ca.status = 'active'
    GROUP BY ca.id, ca.name, ca.status
    ORDER BY ca.name
  `);
  console.log("\nActive campaigns now:");
  final.rows.forEach(r => console.log(`  • ${r.name} (${r.status}, ${r.templates} templates)`));

  await c.end();
  console.log(`\nDone. Inserted ${inserted} new template(s).`);
})();
