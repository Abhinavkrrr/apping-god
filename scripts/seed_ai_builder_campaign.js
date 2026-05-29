// Creates a THIRD campaign called 'AI Builder Internship' alongside the
// existing 'Outreach' and 'SaaS Sales' campaigns. Seeds 4 templates
// (first-touch + 3 follow-ups) that lead with AI-tooling fluency, then
// list two professional experiences, then close with the standard sig.
//
// The two-experience paragraphs are intentionally placeholder text marked
// ⚠️ EDIT ME — the user is expected to fill in their real experiences via
// the /templates UI before clicking Generate. The placeholders are visually
// loud so they can't accidentally get included in a real outgoing draft.
//
// Idempotent — safe to re-run. Won't duplicate the campaign or overwrite
// existing templates unless --reset is passed.
//
//   node scripts/seed_ai_builder_campaign.js
//   node scripts/seed_ai_builder_campaign.js --reset    # wipe + reseed templates

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
  "Exploring Internship Roles in Product Management / Founder's Office / AI at {{company}}";

const FIRST_TOUCH_BODY = `Hi {{first_name}},

I'm Abhinav Kumar, a 3rd-year Chemical Engineering undergraduate at IIT Bombay, exploring a remote internship in **Product Management / Founder's Office / Strategy / AI** roles at {{company}}.

What sets me apart beyond the standard CV: I'm a power user of **Claude Code, GPT-4o, Cursor, Lovable, v0** — and I ship complete production-grade products in days, not weeks. Two examples from my recent work:

**1. ⚠️ EDIT ME: Experience #1**
⚠️ Replace this whole paragraph via /templates before clicking Generate. Example format: "Product Manager Intern at <Company> · <Month-Month YYYY> · One-sentence concrete achievement with a metric. Second sentence on scope or impact."

**2. ⚠️ EDIT ME: Experience #2**
⚠️ Replace this paragraph too. Same format works well.

Would love a 15-minute call to discuss how I could contribute at {{company}}.

Best,
**Abhinav Kumar**
+91 6201395251 | [LinkedIn](https://www.linkedin.com/in/abhinav-kumar-499004280/)
IIT Bombay | Class of 2027`;

const FOLLOWUP_1_BODY = `Hi {{first_name}},

Floating my note back to the top of your inbox.

If a quick chat about a remote internship at **{{company}}** would help — even 10 minutes — I'm flexible on time and happy to walk through working demos of what I've built recently.

Best,
**Abhinav**`;

const FOLLOWUP_2_BODY = `Hi {{first_name}},

One more nudge — promise this is the second-last.

I keep reaching out because the AI-first way I work is genuinely different from how most interns operate, and I think it would compound well at {{company}}'s pace. Worth 10 minutes to find out if there's a fit?

Best,
**Abhinav**`;

const FOLLOWUP_3_BODY = `Hi {{first_name}},

Closing the loop here. If a remote internship at **{{company}}** isn't open right now, totally fine — but if anything opens up later, my inbox is open.

Wishing you and the team continued growth.

Best,
**Abhinav Kumar**
+91 6201395251 | [LinkedIn](https://www.linkedin.com/in/abhinav-kumar-499004280/)`;

const STEPS = [
  { step: 0, body: FIRST_TOUCH_BODY, is_followup: false, delay: 0, variant: "default" },
  { step: 1, body: FOLLOWUP_1_BODY, is_followup: true,  delay: 2, variant: "followup-1" },
  { step: 2, body: FOLLOWUP_2_BODY, is_followup: true,  delay: 2, variant: "followup-2" },
  { step: 3, body: FOLLOWUP_3_BODY, is_followup: true,  delay: 2, variant: "followup-3" },
];

(async () => {
  const c = new Client(POOLER);
  await c.connect();
  console.log("Connected.");

  // 1. Find or create the campaign
  let { rows } = await c.query(
    "SELECT id, resume_id FROM campaigns WHERE name = 'AI Builder Internship'"
  );
  let campaignId;
  if (rows.length === 0) {
    const ins = await c.query(`
      INSERT INTO campaigns
        (name, target_role, status, send_window_local_hour, send_window_local_minute, send_days)
      VALUES
        ('AI Builder Internship', 'Product / Founder''s Office / Strategy / AI internship — AI-tooling angle',
         'active', 10, 30, ARRAY[1,2,3,4,5])
      RETURNING id, resume_id
    `);
    campaignId = ins.rows[0].id;
    console.log("  ✓ Created campaign 'AI Builder Internship' (active)");
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

  // Show final state of all active campaigns
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
  console.log(`\n⚠️  IMPORTANT: open /templates in the dashboard and replace the two`);
  console.log(`    ⚠️ EDIT ME placeholders with your real experiences BEFORE clicking Generate.`);
  console.log(`    Otherwise the draft will contain the literal placeholder text.`);
})();
