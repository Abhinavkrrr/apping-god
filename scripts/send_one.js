// End-to-end send test (sends via Supabase Edge Function so it works on
// networks that block SMTP — like college/hostel WiFi).
//
// Usage:
//   node scripts/send_one.js                            → sends test email to YOURSELF
//   node scripts/send_one.js <recipient_email>          → sends to that contact (from contacts table)
//   node scripts/send_one.js --campaign Product <email> → use a specific campaign
//   node scripts/send_one.js --dry-run                  → render only, don't send
//   node scripts/send_one.js --skip-llm                 → use raw company_brief, skip Gemini

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const crypto = require("crypto");
const { getSupabase } = require("./lib/supabase");
const { render, buildContext } = require("./lib/render");
const { rewriteCompanyBrief } = require("./lib/llm");
const { plainToTrackedHtml, plainWithFooter } = require("./lib/tracking");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipLlm = args.includes("--skip-llm");
const campaignIdx = args.indexOf("--campaign");
const campaignName = campaignIdx >= 0 ? args[campaignIdx + 1] : "Outreach";
const recipient = args.find(a => a.includes("@")) || process.env.SENDER_EMAIL;

const FUNCTION_URL = `https://${process.env.SUPABASE_PROJECT_REF}.functions.supabase.co/send-worker`;

(async () => {
  const sb = getSupabase();

  console.log("================================================");
  console.log("Apping God — end-to-end send test");
  console.log("================================================");
  console.log(`Recipient: ${recipient}`);
  console.log(`Campaign:  ${campaignName}`);
  console.log(`Mode:      ${dryRun ? "DRY RUN (no email sent)" : "LIVE SEND via Edge Function"}`);
  console.log(`LLM:       ${skipLlm ? "skipped" : "Gemini 2.0 Flash"}`);
  console.log("================================================\n");

  // 1) Resolve contact
  let { data: contact } = await sb
    .from("contacts").select("*")
    .eq("email", recipient.toLowerCase()).maybeSingle();
  let isSyntheticSelfTest = false;
  if (!contact) {
    isSyntheticSelfTest = true;
    contact = {
      id: null,
      first_name: (process.env.SENDER_NAME || "Abhinav").split(" ")[0],
      last_name: null,
      email: recipient,
      title: null,
      company_id: null,
    };
    console.log(`[contact] No row found — synthesizing self-test for ${recipient}`);
  } else {
    console.log(`[contact] ${contact.first_name} ${contact.last_name || ""} <${contact.email}>`);
  }

  // 2) Resolve company
  let company = null;
  if (contact.company_id) {
    const { data: c } = await sb.from("companies").select("*").eq("id", contact.company_id).single();
    company = c;
  }
  if (!company) {
    company = {
      id: null,
      name: isSyntheticSelfTest ? "your own inbox" : "the company",
      brief_one_line: isSyntheticSelfTest
        ? "I'm sending this to myself as the first end-to-end test of Apping God — through the Supabase Edge Function, since college SMTP is blocked."
        : null,
      recent_news: null,
    };
  }
  console.log(`[company] ${company.name}`);

  // 3) Campaign + first-touch template
  const { data: campaign } = await sb.from("campaigns").select("*").eq("name", campaignName).single();
  if (!campaign) { console.error(`Campaign "${campaignName}" not found.`); process.exit(1); }
  const { data: seq } = await sb
    .from("sequences").select("*, templates(*)")
    .eq("campaign_id", campaign.id).eq("step_number", 0).single();
  if (!seq || !seq.templates) { console.error("No first-touch template."); process.exit(1); }
  const template = seq.templates;
  console.log(`[template] ${template.variant_label} (resume_id: ${campaign.resume_id || "none"})`);

  // 4) LLM personalization
  let openerLine = company.brief_one_line || "";
  if (!skipLlm && company.id) {
    console.log("[llm] Calling Gemini for opener rewrite...");
    openerLine = await rewriteCompanyBrief({ company });
    console.log(`[llm] → "${openerLine}"`);
  } else if (skipLlm) {
    console.log(`[llm] Skipped. Using: "${openerLine}"`);
  }

  // 5) Insert sends row (so we have a real send_id for tracking)
  let sendId;
  if (contact.id) {
    const { data: row, error } = await sb.from("sends").insert({
      contact_id: contact.id,
      campaign_id: campaign.id,
      sequence_step: 0,
      template_id: template.id,
      resume_id: campaign.resume_id,
      status: "sending",
    }).select("id").single();
    if (error) { console.error("Insert sends:", error.message); process.exit(1); }
    sendId = row.id;
    console.log(`[send] Inserted sends row: ${sendId}`);
  } else {
    sendId = crypto.randomUUID();
    console.log(`[send] Synthetic send_id (self-test): ${sendId}`);
  }

  // 6) Render with tracking
  const ctx = buildContext(contact, company, { company_brief_one_line: openerLine });
  const subject = render(template.subject_tmpl, ctx);
  const text = render(template.body_tmpl, ctx);
  const htmlBody = plainToTrackedHtml(text, sendId);
  const textWithFooter = plainWithFooter(text, sendId);

  console.log("\n----- SUBJECT -----");
  console.log(subject);
  console.log("\n----- BODY -----");
  console.log(text);
  console.log("\n----- HTML size: " + htmlBody.length + " chars -----");

  if (dryRun) { console.log("\n[DRY RUN] Done."); return; }

  // 7) POST to Edge Function (HTTPS — works on any network)
  console.log(`\n[invoke] POST ${FUNCTION_URL}`);
  const t0 = Date.now();
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: recipient,
      subject,
      text_body: textWithFooter,
      html_body: htmlBody,
      resume_id: campaign.resume_id,
      log_send_id: contact.id ? sendId : undefined,
    }),
  });
  const took = Date.now() - t0;
  const out = await res.json();

  console.log(`[invoke] HTTP ${res.status} in ${took}ms`);
  console.log("\n================================================");
  if (res.ok && out.ok) {
    console.log("✓ SENT");
    console.log("================================================");
    console.log(`From:        ${out.from_account}`);
    console.log(`To:          ${out.to}`);
    console.log(`Message-ID:  ${out.message_id}`);
    console.log(`Resume:      ${out.attached_resume ? out.attached_filename : "not attached"}`);
    console.log(`Tracking:    open pixel + link rewriting via Cloudflare`);
    console.log("================================================");
    console.log(`\nCheck ${recipient}. Opening the email should fire an "open" event.`);
    console.log(`Then run:  node scripts/check_events.js ${sendId}`);
  } else {
    console.log("✗ FAILED");
    console.log("================================================");
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }
})();
