// Inserts the locked v1 email template + 3 follow-ups, attached to all 3 campaigns.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com",
  port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
};

const SUBJECT_TMPL =
  "Exploring Internship Roles in Product Management / Founder's Office / Strategy at {{company}}";

const FIRST_TOUCH_BODY = `Hi {{first_name}},

{{company_brief_one_line}}

Quick intro — I'm Abhinav, 3rd-year Chemical Engineering at IIT Bombay. Last two summers I was PM intern at Turtlemint (shipped an NL→SQL agent that cut analyst load 60%) and AI PM intern at Vijya Fintech (built a multi-agent customer-success chatbot resolving 65% of inbound tickets).

I'm looking for a remote summer internship in Product Management, Founder's Office, or Strategy at {{company}}. Would love 15 minutes to chat — or if you can point me to the right person, I'd really appreciate it.

Resume attached.

Best,
Abhinav Kumar
+91 6201395251 · LinkedIn`;

const FOLLOWUP_1_BODY = `Hi {{first_name}},

Just floating this back to the top of your inbox in case it got buried.

If a 15-min chat about a remote summer internship at {{company}} isn't the right fit — totally understand. A quick pointer to the right person on your team would also mean a lot.

Best,
Abhinav`;

const FOLLOWUP_2_BODY = `Hi {{first_name}},

Last note from me — promise.

Still very keen on a remote Product Management, Founder's Office, or Strategy internship at {{company}} this summer. If there's any path in, I'd love to know.

If now isn't the right time, no worries — happy to circle back later in the year.

Best,
Abhinav`;

const FOLLOWUP_3_BODY = `Hi {{first_name}},

Closing the loop here. If anything opens up at {{company}} down the line — for a Product Management, Founder's Office, or Strategy intern — my inbox is open.

Best of luck with everything you're shipping.

Best,
Abhinav`;

(async () => {
  const c = new Client(POOLER);
  await c.connect();
  console.log("Connected.");

  const camp = await c.query("SELECT id, name FROM public.campaigns ORDER BY name");
  console.log(`Found ${camp.rows.length} campaigns.`);

  let inserted = 0;
  for (const row of camp.rows) {
    const cid = row.id;
    // Clean existing
    await c.query("DELETE FROM public.sequences WHERE campaign_id = $1", [cid]);
    await c.query("DELETE FROM public.templates WHERE campaign_id = $1", [cid]);

    // First touch
    const t0 = await c.query(
      `INSERT INTO public.templates
         (campaign_id, variant_label, subject_tmpl, body_tmpl, personalization_level, is_followup, followup_step)
       VALUES ($1, 'default', $2, $3, 'medium', false, NULL)
       RETURNING id`,
      [cid, SUBJECT_TMPL, FIRST_TOUCH_BODY]
    );
    const t0Id = t0.rows[0].id;
    inserted++;

    // Follow-ups (subject = "Re: " + base)
    const fSubject = `Re: ${SUBJECT_TMPL}`;
    const t1 = await c.query(
      `INSERT INTO public.templates
         (campaign_id, variant_label, subject_tmpl, body_tmpl, personalization_level, is_followup, followup_step)
       VALUES ($1, 'followup-1', $2, $3, 'light', true, 1)
       RETURNING id`,
      [cid, fSubject, FOLLOWUP_1_BODY]
    );
    const t2 = await c.query(
      `INSERT INTO public.templates
         (campaign_id, variant_label, subject_tmpl, body_tmpl, personalization_level, is_followup, followup_step)
       VALUES ($1, 'followup-2', $2, $3, 'light', true, 2)
       RETURNING id`,
      [cid, fSubject, FOLLOWUP_2_BODY]
    );
    const t3 = await c.query(
      `INSERT INTO public.templates
         (campaign_id, variant_label, subject_tmpl, body_tmpl, personalization_level, is_followup, followup_step)
       VALUES ($1, 'followup-3', $2, $3, 'light', true, 3)
       RETURNING id`,
      [cid, fSubject, FOLLOWUP_3_BODY]
    );
    inserted += 3;

    // Sequence: step 0=first-touch, step 1=day2, step 2=day4, step 3=day6
    await c.query(`INSERT INTO public.sequences (campaign_id, step_number, template_id, delay_days) VALUES ($1, 0, $2, 0)`, [cid, t0Id]);
    await c.query(`INSERT INTO public.sequences (campaign_id, step_number, template_id, delay_days) VALUES ($1, 1, $2, 2)`, [cid, t1.rows[0].id]);
    await c.query(`INSERT INTO public.sequences (campaign_id, step_number, template_id, delay_days) VALUES ($1, 2, $2, 2)`, [cid, t2.rows[0].id]);
    await c.query(`INSERT INTO public.sequences (campaign_id, step_number, template_id, delay_days) VALUES ($1, 3, $2, 2)`, [cid, t3.rows[0].id]);

    console.log(`  ✓ campaign "${row.name}" → 4 templates + 4 sequence steps`);
  }
  console.log(`\n✓ Inserted ${inserted} templates total.`);
  await c.end();
})();
