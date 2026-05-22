// SMTP-based email verifier.
// For each contact with email_status='unverified', does an MX lookup + SMTP
// RCPT TO probe to determine if the address actually accepts mail.
//
// IMPORTANT: This script does NOT send any email — it only opens a connection,
// says HELO + MAIL FROM + RCPT TO, then QUIT. The reply tells us if the address exists.
//
// Network requirement: outbound port 25 must be open. On networks that block 25
// (like college WiFi), this script will report all as 'risky' — run from a
// machine with open port 25, or use the Snov.io API fallback.
//
// Usage:
//   node scripts/verify_emails.js                 → up to 100 unverified
//   node scripts/verify_emails.js --limit 25
//   node scripts/verify_emails.js --dry-run       → just resolve MX, don't probe

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const dns = require("dns").promises;
const net = require("net");
const { getSupabase } = require("./lib/supabase");

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] || "100", 10) : 100;
const FROM = process.env.SENDER_EMAIL || "test@example.com";

async function probe(email) {
  const [, domain] = email.split("@");
  if (!domain) return { status: "invalid", reason: "no domain" };

  let mx;
  try {
    mx = await dns.resolveMx(domain);
    if (!mx.length) return { status: "invalid", reason: "no MX records" };
  } catch (e) {
    return { status: "invalid", reason: `MX lookup: ${e.code || e.message}` };
  }
  mx.sort((a, b) => a.priority - b.priority);

  if (dry) return { status: "risky", reason: "dry-run", mx: mx[0].exchange };

  return new Promise((resolve) => {
    const host = mx[0].exchange;
    const sock = net.createConnection({ host, port: 25, timeout: 10000 });
    let stage = 0;
    const cleanup = (result) => { try { sock.destroy(); } catch (_) {} resolve(result); };

    sock.on("error", (e) => cleanup({ status: "risky", reason: `connect: ${e.code}` }));
    sock.on("timeout", () => cleanup({ status: "risky", reason: "timeout" }));

    sock.on("data", (buf) => {
      const lines = buf.toString().split(/\r?\n/);
      for (const line of lines) {
        if (!line) continue;
        if (stage === 0 && /^220/.test(line)) {
          sock.write(`HELO appingverifier.dev\r\n`); stage = 1;
        } else if (stage === 1 && /^250/.test(line)) {
          sock.write(`MAIL FROM:<${FROM}>\r\n`); stage = 2;
        } else if (stage === 2 && /^250/.test(line)) {
          sock.write(`RCPT TO:<${email}>\r\n`); stage = 3;
        } else if (stage === 3) {
          if (/^250/.test(line)) cleanup({ status: "valid", reason: "RCPT accepted" });
          else if (/^550|^551|^553|^521/.test(line)) cleanup({ status: "invalid", reason: line.slice(0, 80) });
          else cleanup({ status: "risky", reason: line.slice(0, 80) });
        }
      }
    });
  });
}

(async () => {
  const sb = getSupabase();
  const { data: contacts } = await sb.from("contacts")
    .select("id, email").eq("email_status", "unverified").limit(limit);

  if (!contacts || contacts.length === 0) { console.log("Nothing to verify."); return; }
  console.log(`Verifying ${contacts.length} addresses... (port 25 outbound required)\n`);

  let valid = 0, invalid = 0, risky = 0;
  for (const c of contacts) {
    process.stdout.write(`  ${c.email} ... `);
    const r = await probe(c.email);
    console.log(`${r.status}  ${r.reason || ""}`);
    await sb.from("contacts").update({ email_status: r.status }).eq("id", c.id);
    if (r.status === "valid") valid++;
    else if (r.status === "invalid") invalid++;
    else risky++;
  }
  console.log(`\nDone. valid=${valid}  invalid=${invalid}  risky=${risky}`);
})();
