// Apollo.io enrichment — for each contact missing a title or LinkedIn,
// query Apollo's people/match endpoint to fill in the gaps.
//
// Free tier: ~50 credits/month. Run sparingly.
//
// Usage:
//   node scripts/enrich_apollo.js                  → up to 20 contacts
//   node scripts/enrich_apollo.js --limit 5

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { getSupabase } = require("./lib/supabase");

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || "20", 10) : 20;

const APOLLO_KEY = process.env.APOLLO_API_KEY;

async function lookup(email) {
  const res = await fetch("https://api.apollo.io/v1/people/match", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": APOLLO_KEY },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.person || null;
}

(async () => {
  if (!APOLLO_KEY) { console.error("APOLLO_API_KEY missing"); process.exit(1); }
  const sb = getSupabase();
  const { data: contacts } = await sb.from("contacts")
    .select("id, email, title, linkedin_url")
    .or("title.is.null,linkedin_url.is.null")
    .limit(limit);

  if (!contacts || contacts.length === 0) { console.log("Nothing to enrich."); return; }
  console.log(`Enriching ${contacts.length} contact(s) via Apollo...\n`);

  let enriched = 0, miss = 0;
  for (const c of contacts) {
    process.stdout.write(`  ${c.email} ... `);
    const p = await lookup(c.email);
    if (!p) { console.log("not found"); miss++; continue; }
    const patch = {};
    if (!c.title && p.title) patch.title = p.title;
    if (!c.linkedin_url && p.linkedin_url) patch.linkedin_url = p.linkedin_url;
    if (Object.keys(patch).length) {
      await sb.from("contacts").update(patch).eq("id", c.id);
      console.log(`✓ ${Object.keys(patch).join(", ")}`);
      enriched++;
    } else { console.log("nothing new"); miss++; }
  }
  console.log(`\nDone. enriched=${enriched}  no-data=${miss}`);
})();
