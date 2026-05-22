// Hunter.io enrichment — for contacts with no email, attempts to find one
// using first/last name + company domain via Hunter's email-finder.
//
// Free tier: 25 searches/month. Run sparingly.
//
// Usage:
//   node scripts/enrich_hunter.js                  → up to 10 contacts missing emails
//   node scripts/enrich_hunter.js --limit 5

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { getSupabase } = require("./lib/supabase");

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || "10", 10) : 10;
const HUNTER_KEY = process.env.HUNTER_API_KEY;

async function findEmail({ firstName, lastName, domain }) {
  const url = new URL("https://api.hunter.io/v2/email-finder");
  url.searchParams.set("domain", domain);
  url.searchParams.set("first_name", firstName);
  if (lastName) url.searchParams.set("last_name", lastName);
  url.searchParams.set("api_key", HUNTER_KEY);

  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.data?.email) return null;
  return {
    email: json.data.email,
    confidence: json.data.score ?? null,
  };
}

(async () => {
  if (!HUNTER_KEY) { console.error("HUNTER_API_KEY missing in .env"); process.exit(1); }
  const sb = getSupabase();

  // Find contacts where email is missing OR equal to a placeholder, with company.domain
  const { data: contacts } = await sb.from("contacts")
    .select("id, first_name, last_name, email, companies(domain, name)")
    .or("email.like.unknown_%,email.like.placeholder_%")
    .limit(limit);

  if (!contacts || contacts.length === 0) {
    console.log("No contacts need Hunter lookup (all have real emails).");
    return;
  }
  console.log(`Looking up ${contacts.length} contacts via Hunter.io...\n`);

  let found = 0, miss = 0;
  for (const c of contacts) {
    const company = c.companies;
    if (!company?.domain) { console.log(`  skip ${c.first_name}: no company domain`); miss++; continue; }
    process.stdout.write(`  ${c.first_name} ${c.last_name || ""} @ ${company.domain} ... `);
    const r = await findEmail({ firstName: c.first_name, lastName: c.last_name, domain: company.domain });
    if (!r) { console.log("not found"); miss++; continue; }
    await sb.from("contacts").update({
      email: r.email,
      email_status: r.confidence >= 80 ? "valid" : "risky",
    }).eq("id", c.id);
    console.log(`✓ ${r.email} (${r.confidence})`);
    found++;
  }
  console.log(`\nDone. found=${found}  miss=${miss}`);
})();
