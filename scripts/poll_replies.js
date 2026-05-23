// Polls Gmail IMAP for new replies, matches them to existing sends via
// In-Reply-To header, classifies via Groq, and writes rows to replies + events.
//
// Runs from your laptop OR GitHub Actions — heavy IMAP work that Supabase
// Edge Functions can't do (resource limit on free tier).
//
// Usage:
//   node scripts/poll_replies.js               → poll once and exit
//   node scripts/poll_replies.js --since 0     → ignore last UID cursor, fetch all
//
// Network: requires outbound port 993 (IMAP TLS). Most networks allow this
// even when SMTP (25/465/587) is blocked.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ImapFlow } = require("imapflow");
const { getSupabase } = require("./lib/supabase");

const args = process.argv.slice(2);
const sinceArgIdx = args.indexOf("--since");
const forceSince = sinceArgIdx >= 0 ? parseInt(args[sinceArgIdx + 1] || "0", 10) : null;

const CLASSIFY_SYSTEM = `Classify the email reply into exactly one category:
- positive: interested, wants to chat, asking for time
- negative: not interested, declined, "no thanks"
- out_of_office: OOO / vacation / parental leave auto-reply
- auto_reply: thank-you-for-email autoresponder, ticket created, etc.
- question: asking a specific question that needs human response
- other: anything else
Respond with ONLY the category word, nothing else.`;

async function classify(body) {
  if (!process.env.GROQ_API_KEY || !body) return "other";
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: CLASSIFY_SYSTEM },
          { role: "user", content: body.slice(0, 2000) },
        ],
        max_tokens: 10, temperature: 0,
      }),
    });
    const json = await res.json();
    const out = json.choices?.[0]?.message?.content?.trim().toLowerCase();
    const valid = ["positive", "negative", "out_of_office", "auto_reply", "question", "other"];
    return valid.includes(out) ? out : "other";
  } catch (e) {
    console.warn("  [classify] failed:", e.message);
    return "other";
  }
}

(async () => {
  const sb = getSupabase();

  // Resolve account row (use GMAIL_USER from env)
  const email = process.env.GMAIL_USER;
  const pwd = process.env.GMAIL_APP_PASSWORD;
  if (!email || !pwd) { console.error("GMAIL_USER/GMAIL_APP_PASSWORD missing"); process.exit(1); }

  let { data: account } = await sb.from("accounts").select("*").eq("email", email).maybeSingle();
  if (!account) {
    const ins = await sb.from("accounts").insert({
      email, smtp_password_enc: pwd, imap_password_enc: pwd, warmup_phase: "active",
    }).select().single();
    account = ins.data;
  }
  const lastUid = forceSince !== null ? forceSince : (account.imap_last_uid ?? 0);

  console.log(`Connecting to imap.gmail.com:993 as ${email}...`);
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: email, pass: pwd },
    logger: false,
  });

  let processed = 0, matched = 0, classified = 0, newestUid = lastUid;

  try {
    await client.connect();
    console.log("✓ Connected.");
    const lock = await client.getMailboxLock("INBOX");
    try {
      // First run (lastUid=0) without a cap would scan the ENTIRE inbox.
      // Limit to last 14 days OR the most recent 200 messages (whichever
      // is fewer) to avoid downloading thousands of irrelevant messages.
      let range;
      if (lastUid > 0) {
        range = `${lastUid + 1}:*`;
      } else {
        const since = new Date(Date.now() - 14 * 86400_000);
        const uids = await client.search({ since }, { uid: true });
        if (!uids || uids.length === 0) {
          console.log("No messages in last 14d.");
          return;
        }
        const startUid = uids[Math.max(0, uids.length - 200)];
        range = `${startUid}:*`;
      }
      console.log(`Fetching UIDs ${range}...`);

      for await (const msg of client.fetch(range, {
        uid: true, envelope: true, source: true, internalDate: true,
      }, { uid: true })) {
        processed++;
        if (msg.uid && msg.uid > newestUid) newestUid = msg.uid;

        const inReplyTo = msg.envelope?.inReplyTo;
        const refs = msg.envelope?.references;
        if (!inReplyTo && !refs) continue;

        // Try matching by In-Reply-To first, then any of the References
        const candidateIds = [inReplyTo, ...(Array.isArray(refs) ? refs : refs ? [refs] : [])].filter(Boolean);
        let parent = null;
        for (const id of candidateIds) {
          const r = await sb.from("sends").select("id").eq("message_id", id).maybeSingle();
          if (r.data) { parent = r.data; break; }
        }
        if (!parent) continue;
        matched++;

        // Skip if already recorded (avoid duplicates on re-run with --since 0)
        const { count: already } = await sb.from("replies")
          .select("id", { count: "exact", head: true }).eq("send_id", parent.id);
        if ((already ?? 0) > 0) {
          console.log(`  uid=${msg.uid} already recorded for send ${parent.id}, skip`);
          continue;
        }

        const raw = msg.source?.toString("utf8") ?? "";
        const bodyMatch = raw.match(/\r?\n\r?\n([\s\S]+)/);
        const body = bodyMatch ? bodyMatch[1].slice(0, 4000) : raw.slice(0, 4000);
        const fromEmail = msg.envelope?.from?.[0]?.address ?? "";

        const classification = await classify(body);
        classified++;
        console.log(`  ✉ reply from ${fromEmail} → send ${parent.id} → ${classification}`);

        await sb.from("replies").insert({
          send_id: parent.id,
          received_at: msg.internalDate?.toISOString() ?? new Date().toISOString(),
          from_email: fromEmail,
          raw_body: body,
          classification,
          requires_action: classification === "positive" || classification === "question",
        });
        await sb.from("events").insert({
          send_id: parent.id, type: "reply",
          metadata: { from: fromEmail, classification },
        });

        if (classification !== "auto_reply" && classification !== "out_of_office") {
          await sb.from("sends").update({ next_followup_at: null }).eq("id", parent.id);
        } else if (classification === "out_of_office") {
          const pause = new Date(Date.now() + 7 * 86400_000).toISOString();
          await sb.from("sends").update({ next_followup_at: pause }).eq("id", parent.id);
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    console.error("✗", e.message);
    process.exit(1);
  }

  if (newestUid > lastUid) {
    await sb.from("accounts").update({ imap_last_uid: newestUid }).eq("id", account.id);
    console.log(`Updated last_uid: ${lastUid} → ${newestUid}`);
  }

  console.log(`\nDone. processed=${processed} matched=${matched} classified=${classified}`);
})();
