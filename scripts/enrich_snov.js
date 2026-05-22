// Snov.io email verifier — verifies an email address actually exists,
// checking MX, SMTP, catch-all status, etc. via Snov's REST API.
//
// Snov uses OAuth2 client_credentials: USER_ID + API_SECRET → access token.
// Free trial: 50 credits.
//
// Usage:
//   node scripts/enrich_snov.js                  → verify up to 25 unverified
//   node scripts/enrich_snov.js --limit 10

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { getSupabase } = require("./lib/supabase");

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || "25", 10) : 25;

const USER_ID = process.env.SNOV_USER_ID;
const API_SECRET = process.env.SNOV_API_SECRET;

let _token = null;

async function getToken() {
  if (_token) return _token;
  const res = await fetch("https://api.snov.io/v1/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: USER_ID, client_secret: API_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Snov auth: HTTP ${res.status}`);
  const json = await res.json();
  _token = json.access_token;
  return _token;
}

async function verifyEmail(email) {
  const token = await getToken();
  const res = await fetch("https://api.snov.io/v1/email-verifier", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: token, email }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.data?.result ?? null; // 'valid' | 'invalid' | 'catchAll' | 'unknown'
}

(async () => {
  if (!USER_ID || !API_SECRET) { console.error("SNOV_USER_ID/SNOV_API_SECRET missing"); process.exit(1); }
  const sb = getSupabase();

  const { data: contacts } = await sb.from("contacts").select("id, email")
    .eq("email_status", "unverified").limit(limit);

  if (!contacts || contacts.length === 0) { console.log("Nothing to verify."); return; }
  console.log(`Verifying ${contacts.length} emails via Snov.io...\n`);

  let valid = 0, invalid = 0, risky = 0;
  for (const c of contacts) {
    process.stdout.write(`  ${c.email} ... `);
    const result = await verifyEmail(c.email);
    let status = "risky";
    if (result === "valid") { status = "valid"; valid++; }
    else if (result === "invalid") { status = "invalid"; invalid++; }
    else { status = "risky"; risky++; }
    console.log(`${result} → ${status}`);
    await sb.from("contacts").update({ email_status: status }).eq("id", c.id);
  }
  console.log(`\nDone. valid=${valid}  invalid=${invalid}  risky=${risky}`);
})();
