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

const FIRST_TOUCH_BODY = `Dear {{first_name}},

Warm Greetings!

I am Abhinav Kumar, a third-year **Chemical Engineering** undergraduate at **IIT Bombay** (Class of 2027), exploring a **remote internship** at {{company}} in **Product Management**, **Founder's Office**, or **Strategy**.

{{company_brief_one_line}}

**Professional Experience:**

• **Turtlemint (Product Manager Intern)** – Owned the end-to-end Loan Marketplace customer journey, shipped voice-assistant and credit-score uplift features that boosted user engagement by **32%** and reduced funnel drop-off by **24%** across **15K+** monthly users. Also built a Natural-Language-to-SQL self-serve analytics tool with an LLM agent, cutting data-pull turnaround from 2 days to under 5 minutes and eliminating **60%** of ad-hoc analyst requests.

• **Vijya Fintech (AI Product Manager Intern)** – Designed an AI Customer Success Chatbot on a multi-agent architecture that autonomously resolved **65%** of inbound emails and saved the support team **40+ hours weekly**. Built an AI Lead Management System integrating web scrapers, agentic data cleaners, and transformer-based enrichment, **tripling qualified lead throughput** and lifting sales conversion by **22%**.

**Key Projects:**

• **FMCG Contract Manufacturing & Supply Chain (ShARE, IIT Bombay)** – Secured a **Top 5** position (Special Mention) among 80+ national teams; designed a scalable B2B distribution network projected to generate **₹75 Lakhs** in monthly revenue at an **18%** annual profit margin.

• **Future of Automobiles (Consult Club, IIT Guwahati)** – Designed a market entry strategy for BEVs, Green Fuel CNG, and Hybrid vehicles targeting a **$19 billion** segment, with a lifecycle emissions assessment identifying a **25%** reduction in operating expenses.

• **Equity Research – Tata Power Ltd. (Finance Club, IIT Bombay)** – Conducted full financial valuation; benchmarked P/E, Quick ratio, EPS, and ROE against 3+ competitors and identified technical confluences using MACD and RSI indicators.

**Institute Leadership:**

• **Associate Secretary, Chemical Engineering Association (ChEA)** – Led a 14-member council representing **800+ students** with a **₹10L budget**; planned and executed flagship events including Convocation, Freshers Orientation, Industrial Visits, and the Student-Industry Meet.

• **Hostel Cricket Captain** – Led the hostel team to **2nd position** in the Inter-Hostel Cricket GC and to **victory** in the Intra-Hostel Tournament; completed a 1-year professional cricket training program under the National Sports Organisation.

I am open to a **fully remote internship** of 8–12 weeks and would be grateful for the opportunity to contribute at {{company}}, or to be connected to the right person on your team. My **resume is attached** for your reference.

Please feel free to reach out at abhinavkrrr@gmail.com or +91 6201395251.

Thank you for your time and consideration.

Best Regards,
**Abhinav Kumar**
+91 6201395251 | LinkedIn
IIT Bombay | Class of 2027`;

const FOLLOWUP_1_BODY = `Dear {{first_name}},

Warm Greetings!

Just floating my note from a couple of days ago back to the top of your inbox in case it got buried.

I remain very keen on a **remote internship** at {{company}} in **Product Management**, **Founder's Office**, or **Strategy** — happy to work fully remotely across any timezone you operate in. A 15-minute conversation, or a pointer to the right person on your team, would mean a great deal.

Thank you for your time.

Best Regards,
**Abhinav Kumar**
+91 6201395251 | LinkedIn`;

const FOLLOWUP_2_BODY = `Dear {{first_name}},

Warm Greetings!

One more follow-up — I promise this will be brief.

I remain very interested in contributing at {{company}} in a **remote** **Product Management**, **Founder's Office**, or **Strategy internship** capacity. If now is not the right moment, I would be glad to reconnect later in the year.

Thank you again for your consideration.

Best Regards,
**Abhinav Kumar**
+91 6201395251 | LinkedIn`;

const FOLLOWUP_3_BODY = `Dear {{first_name}},

Closing the loop here. If anything opens up at {{company}} down the line for a **remote intern** in **Product Management**, **Founder's Office**, or **Strategy**, my inbox is always open.

Wishing you and the team continued success.

Best Regards,
**Abhinav Kumar**
+91 6201395251 | LinkedIn`;

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
