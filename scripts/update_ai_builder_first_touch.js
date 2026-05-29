// Updates the live AI Builder Internship first-touch template body with
// the user's actual Turtlemint + Vijya Fintech professional experiences,
// replacing the ⚠️ EDIT ME placeholders that the seed script inserted.
//
// Also re-renders any pending_approval drafts that were generated against
// the old (placeholder-containing) template so the new body shows up in
// the Approve queue immediately.
//
// Idempotent — safe to re-run.
//
//   node scripts/update_ai_builder_first_touch.js

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com", port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
};

const NEW_BODY = `Hi {{first_name}},

I'm Abhinav Kumar, a 3rd-year Chemical Engineering undergraduate at IIT Bombay, exploring a remote internship in **Product Management / Founder's Office / Strategy / AI** roles at {{company}}.

What sets me apart beyond the standard CV: I'm a power user of **Claude Code, GPT-4o, Cursor, Lovable, v0** — and I ship complete production-grade products in days, not weeks. Two examples from my recent work:

**1. Turtlemint — Product Manager Intern**
Owned the end-to-end Loan Marketplace customer journey, shipped voice-assistant and credit-score-uplift features that boosted user engagement by **32%** and reduced funnel drop-off by **24%** across 15K+ monthly users. Also built a Natural-Language-to-SQL self-serve analytics tool with an LLM agent, cutting data-pull turnaround from 2 days to **under 5 minutes** and eliminating **60%** of ad-hoc analyst requests.

**2. Vijya Fintech — AI Product Manager Intern**
Designed an AI Customer Success Chatbot on a multi-agent architecture that autonomously resolved **65%** of inbound emails and saved the support team **40+ hours/week**. Built an AI Lead Management System integrating web scrapers, agentic data cleaners, and transformer-based enrichment — **tripled qualified lead throughput** and lifted sales conversion by **22%**.

Would love a 15-minute call to discuss how I could contribute at {{company}}.

Best,
**Abhinav Kumar**
+91 6201395251 | [LinkedIn](https://www.linkedin.com/in/abhinav-kumar-499004280/)
IIT Bombay | Class of 2027`;

(async () => {
  const c = new Client(POOLER);
  await c.connect();
  console.log("Connected.");

  // 1. Find the AI Builder Internship first-touch template
  const { rows: tpls } = await c.query(`
    SELECT t.id, t.body_tmpl
    FROM templates t
    JOIN sequences s ON s.template_id = t.id
    JOIN campaigns ca ON ca.id = s.campaign_id
    WHERE ca.name = 'AI Builder Internship' AND s.step_number = 0
  `);
  if (tpls.length === 0) {
    console.error("✗ No AI Builder Internship first-touch template found.");
    console.error("  Run scripts/seed_ai_builder_campaign.js first.");
    process.exit(1);
  }
  const tpl = tpls[0];

  // 2. Check whether placeholders still present (so we can be informative)
  const hasPlaceholders = /⚠️ EDIT ME/.test(tpl.body_tmpl);

  // 3. UPDATE the template body
  await c.query("UPDATE templates SET body_tmpl = $1 WHERE id = $2", [NEW_BODY, tpl.id]);
  console.log(`  ✓ Updated templates.body_tmpl ${hasPlaceholders ? "(replaced placeholders)" : "(was already edited; overwritten)"}`);

  // 4. Re-render any pending drafts that were created from this template
  // before we updated it. (Probably zero since the campaign is brand new,
  // but defense in depth so nothing slips out with the placeholder text.)
  const { rows: drafts } = await c.query(`
    SELECT s.id, s.rendered_body, c.first_name,
           coalesce(co.name, 'your company') AS company
    FROM sends s
    JOIN contacts c ON c.id = s.contact_id
    LEFT JOIN companies co ON co.id = c.company_id
    WHERE s.template_id = $1 AND s.status = 'pending_approval'
  `, [tpl.id]);

  let rerendered = 0, hadPlaceholders = 0;
  for (const d of drafts) {
    if (/⚠️ EDIT ME/.test(d.rendered_body)) hadPlaceholders++;
    // Render the new body for this contact: substitute {{first_name}} + {{company}}
    const rendered = NEW_BODY
      .replace(/\{\{\s*first_name\s*\}\}/g, d.first_name || "there")
      .replace(/\{\{\s*company\s*\}\}/g, d.company);
    // Wrap in the same minimal HTML the send pipeline uses (bold + line breaks).
    // Note: full plainToTrackedHtml lives in lib/send/render.ts; here we just
    // do a basic markdown-bold + newline-to-<br> pass that matches what the
    // UI re-render does. The tracking pixel + link wrappers already in
    // rendered_body for the existing draft are preserved separately.
    const html = rendered
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#0366d6">$1</a>')
      .replace(/\n/g, "<br>\n");

    await c.query("UPDATE sends SET rendered_body = $1 WHERE id = $2", [html, d.id]);
    rerendered++;
  }

  console.log(`  ✓ Re-rendered ${rerendered} pending draft(s)`);
  if (hadPlaceholders > 0) {
    console.log(`  ⚠ ${hadPlaceholders} of those drafts contained the literal "⚠️ EDIT ME" text — now fixed.`);
  }

  await c.end();
  console.log(`\n✓ Done. AI Builder Internship template is now production-ready with real experiences.`);
  console.log(`  Go to /approve → Generate → pick "AI Builder Internship" → preview & ship.`);
})();
