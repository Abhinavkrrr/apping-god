// Generates drafts for the next morning's approval queue.
//
// For each active campaign:
//   • Find contacts tagged with this campaign (custom_fields.campaign_tag)
//     who haven't been sent the first-touch yet AND aren't unsubscribed.
//   • Render the first-touch template (using Gemini for opener if --llm).
//   • Insert sends row with status='pending_approval'.
//   • Insert matching approvals row with status='pending'.
//
// Usage:
//   node scripts/generate_drafts.js                    → for ALL active campaigns
//   node scripts/generate_drafts.js --campaign VC      → just one
//   node scripts/generate_drafts.js --limit 25         → cap at N drafts total
//   node scripts/generate_drafts.js --llm              → use Gemini for personalization
//   node scripts/generate_drafts.js --dry-run

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { getSupabase } = require("./lib/supabase");
const { render, buildContext } = require("./lib/render");
const { rewriteCompanyBrief } = require("./lib/llm");
const { plainToTrackedHtml, plainWithFooter } = require("./lib/tracking");
const crypto = require("crypto");

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const useLlm = args.includes("--llm");
const campaignIdx = args.indexOf("--campaign");
const campaignFilter = campaignIdx >= 0 ? args[campaignIdx + 1] : null;
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || "0", 10) : 50;

(async () => {
  const sb = getSupabase();

  console.log("Apping God — generate drafts");
  console.log(`Mode: ${dry ? "DRY RUN" : "LIVE"}  LLM: ${useLlm ? "on" : "off"}  Limit: ${limit}\n`);

  // Active campaigns
  let q = sb.from("campaigns").select("*").eq("status", "active");
  if (campaignFilter) q = q.eq("name", campaignFilter);
  const { data: campaigns } = await q;
  if (!campaigns || campaigns.length === 0) {
    console.log("No active campaigns. Activate one in /campaigns first.");
    return;
  }
  console.log(`Active campaigns: ${campaigns.map(c => c.name).join(", ")}\n`);

  let created = 0;
  for (const campaign of campaigns) {
    if (limit && created >= limit) break;

    // First-touch template
    const { data: seq } = await sb
      .from("sequences").select("*, templates(*)")
      .eq("campaign_id", campaign.id).eq("step_number", 0).single();
    if (!seq) { console.warn(`  ${campaign.name}: no first-touch template, skip`); continue; }
    const template = seq.templates;

    // Eligible contacts: tagged for this campaign, not unsubscribed,
    // not already sent for it.
    const { data: tagged } = await sb
      .from("contacts").select("*, companies(*)")
      .contains("custom_fields", { campaign_tag: campaign.name })
      .is("unsubscribed_at", null)
      .is("skip_reason", null);

    if (!tagged || tagged.length === 0) {
      console.log(`  ${campaign.name}: no eligible contacts`); continue;
    }

    // Filter out already-touched (sent or pending)
    const { data: existing } = await sb.from("sends").select("contact_id")
      .eq("campaign_id", campaign.id).in("status", ["pending_approval", "approved", "sending", "sent"]);
    const touched = new Set((existing ?? []).map(e => e.contact_id));
    const pool = tagged.filter(c => !touched.has(c.id));

    console.log(`  ${campaign.name}: ${pool.length} eligible after dedupe`);

    for (const contact of pool) {
      if (limit && created >= limit) break;

      const company = contact.companies || { name: "your company", brief_one_line: "" };

      // LLM (optional)
      let opener = company.brief_one_line || "";
      if (useLlm && company.id) {
        opener = await rewriteCompanyBrief({ company });
      }

      // Pre-allocate UUID so tracking pixel + DB row match
      const sendId = crypto.randomUUID();
      const ctx = buildContext(contact, company, { company_brief_one_line: opener });
      const subject = render(template.subject_tmpl, ctx);
      const text = render(template.body_tmpl, ctx);
      const htmlBody = plainToTrackedHtml(text, sendId);
      const textWithFooter = plainWithFooter(text, sendId);

      if (dry) {
        console.log(`    [dry] ${contact.email} ← ${company.name}`);
        created++; continue;
      }

      // Insert sends (with the pre-allocated UUID? Supabase doesn't let us specify
      // the id by default — but we generate one client-side and let DB use that.
      // The `sends.id` column has DEFAULT gen_random_uuid(); we override by passing id.)
      const { error: sErr } = await sb.from("sends").insert({
        id: sendId,
        contact_id: contact.id,
        campaign_id: campaign.id,
        sequence_step: 0,
        template_id: template.id,
        resume_id: campaign.resume_id,
        rendered_subject: subject,
        rendered_body: htmlBody, // store html (worker reads it)
        status: "pending_approval",
      });
      if (sErr) { console.warn(`    skip ${contact.email}: ${sErr.message}`); continue; }

      await sb.from("approvals").insert({ send_id: sendId, status: "pending" });
      created++;
      console.log(`    ✓ ${contact.email} ← ${company.name}`);
    }
  }

  console.log(`\nDone. Created ${created} draft(s).`);
})();
