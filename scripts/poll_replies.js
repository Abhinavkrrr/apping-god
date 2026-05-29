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

// ─────────────────────────────────────────────────────────────────
// BOUNCE DETECTION — DSN (Delivery Status Notification) parsing
// ─────────────────────────────────────────────────────────────────

// Senders we recognize as mail-delivery daemons (case-insensitive). If a
// message comes from one of these, it's not a reply, it's a bounce.
const DAEMON_RE = /(mailer-daemon|postmaster|mail-delivery)/i;

// Subject patterns commonly used by Gmail/Outlook/etc. for DSNs.
const BOUNCE_SUBJECT_RE = /(delivery status notification|undeliverable|delivery failure|delivery incomplete|returned mail|mail delivery failed)/i;

function isBounce(envelope, body) {
  const from = envelope?.from?.[0]?.address ?? "";
  if (DAEMON_RE.test(from)) return true;
  const subj = envelope?.subject ?? "";
  if (BOUNCE_SUBJECT_RE.test(subj)) return true;
  // Last-ditch body sniff (some weird servers don't set sender properly)
  if (/this is an automatically generated delivery status notification/i.test(body)) return true;
  return false;
}

/**
 * Parses a Gmail/SMTP DSN body. Returns { failed_recipient, smtp_status,
 * bounce_type, diagnostic }.
 *   bounce_type:
 *     'hard'    → SMTP 5.x.x or final "failed" action — address is dead
 *     'soft'    → SMTP 4.x.x or "delayed" — temporary problem (mailbox full,
 *                 server timeout). We still block to preserve sender rep.
 *     'unknown' → couldn't parse a status code — treat as soft.
 */
function parseBounce(body) {
  // Final-Recipient: rfc822; user@example.com
  const recipMatch = body.match(/Final-Recipient:\s*rfc822;\s*([^\s<>\r\n]+)/i)
    ?? body.match(/Original-Recipient:\s*rfc822;\s*([^\s<>\r\n]+)/i)
    ?? body.match(/(?:to|recipient).{0,40}?:\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  const failed_recipient = recipMatch ? recipMatch[1].trim().toLowerCase() : null;

  // Status: 5.1.1 — hard. Status: 4.4.7 — soft.
  const statusMatch = body.match(/Status:\s*(\d\.\d+\.\d+)/i);
  const smtp_status = statusMatch ? statusMatch[1] : null;

  // Diagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach does not exist
  const diagMatch = body.match(/Diagnostic-Code:\s*([^\r\n]+)/i)
    ?? body.match(/(?:response was|reason):\s*([^\r\n]+)/i);
  let diagnostic = diagMatch ? diagMatch[1].trim() : null;
  if (diagnostic && diagnostic.length > 500) diagnostic = diagnostic.slice(0, 500);

  // Action: failed | delayed | delivered (we only see failed/delayed in bounces)
  const actionMatch = body.match(/Action:\s*(failed|delayed|delivered)/i);
  const action = actionMatch ? actionMatch[1].toLowerCase() : null;

  let bounce_type = "unknown";
  if (smtp_status) {
    if (smtp_status.startsWith("5.")) bounce_type = "hard";
    else if (smtp_status.startsWith("4.")) bounce_type = "soft";
  }
  // Fallback on Action when no status code
  if (bounce_type === "unknown" && action === "failed") bounce_type = "hard";
  if (bounce_type === "unknown" && action === "delayed") bounce_type = "soft";
  // Body-keyword fallback
  if (bounce_type === "unknown" && /address (not found|does not exist|rejected)|user unknown|no such user/i.test(body)) {
    bounce_type = "hard";
  } else if (bounce_type === "unknown" && /temporary|will retry|mailbox full|timed out|deferred/i.test(body)) {
    bounce_type = "soft";
  }

  return { failed_recipient, smtp_status, bounce_type, diagnostic };
}

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

  let processed = 0, matched = 0, classified = 0, bounced = 0, newestUid = lastUid;

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
          const r = await sb.from("sends").select("id, contact_id").eq("message_id", id).maybeSingle();
          if (r.data) { parent = r.data; break; }
        }
        if (!parent) continue;
        matched++;

        const raw = msg.source?.toString("utf8") ?? "";
        const bodyMatch = raw.match(/\r?\n\r?\n([\s\S]+)/);
        const body = bodyMatch ? bodyMatch[1].slice(0, 4000) : raw.slice(0, 4000);
        const fromEmail = msg.envelope?.from?.[0]?.address ?? "";

        // ─── BOUNCE PATH ──────────────────────────────────────────
        // If this is a DSN, log to bounces + cancel pending sends to this
        // contact + mark the contact unsendable. Skip the reply path
        // entirely so bounces don't pollute the inbox.
        if (isBounce(msg.envelope, body)) {
          const parsed = parseBounce(body);

          // Skip if already recorded for this send today (idempotent re-run safety)
          const { count: dupe } = await sb.from("bounces")
            .select("id", { count: "exact", head: true })
            .eq("send_id", parent.id)
            .eq("smtp_status", parsed.smtp_status ?? "");
          if ((dupe ?? 0) > 0) {
            console.log(`  ↩ bounce uid=${msg.uid} already recorded for send ${parent.id}, skip`);
            continue;
          }

          const { error: bErr } = await sb.from("bounces").insert({
            send_id: parent.id,
            contact_id: parent.contact_id,
            bounce_type: parsed.bounce_type,
            failed_recipient: parsed.failed_recipient,
            smtp_status: parsed.smtp_status,
            diagnostic: parsed.diagnostic,
            from_daemon: fromEmail,
            raw_body: body,
            received_at: msg.internalDate?.toISOString() ?? new Date().toISOString(),
          });
          if (bErr) console.warn("  ⚠ bounce insert:", bErr.message);

          // Stop ALL future sends to this contact (per user request — any
          // bounce, hard or soft, halts the agent for that address).
          if (parent.contact_id) {
            const skipReason = parsed.bounce_type === "hard" ? "hard_bounce" : "soft_bounce";
            await sb.from("contacts").update({
              email_status: "bounced",
              skip_reason: skipReason,
            }).eq("id", parent.contact_id);

            // Cancel anything in the pipeline that hasn't gone out yet
            const { data: cancelled } = await sb.from("sends").update({
              status: "skipped",
              failure_reason: `Contact bounced (${parsed.bounce_type})`,
            })
              .eq("contact_id", parent.contact_id)
              .in("status", ["pending_approval", "approved"])
              .select("id");
            if (cancelled && cancelled.length > 0) {
              await sb.from("approvals").update({ status: "skipped" })
                .in("send_id", cancelled.map(c => c.id));
            }

            // Audit-log the bounce as an event so /overview timeline shows it
            await sb.from("events").insert({
              send_id: parent.id, type: "bounce",
              metadata: {
                bounce_type: parsed.bounce_type,
                smtp_status: parsed.smtp_status,
                failed_recipient: parsed.failed_recipient,
                cancelled_sends: cancelled?.length ?? 0,
              },
            });
          }

          bounced++;
          console.log(`  ↩ ${parsed.bounce_type.toUpperCase()} bounce: ${parsed.failed_recipient ?? fromEmail}${parsed.smtp_status ? ` (${parsed.smtp_status})` : ""} → contact blocked, ${parsed.bounce_type === "hard" ? "hard" : "soft"} stop`);
          continue;
        }

        // ─── REPLY PATH (existing behavior) ───────────────────────
        // Skip if already recorded (avoid duplicates on re-run with --since 0)
        const { count: already } = await sb.from("replies")
          .select("id", { count: "exact", head: true }).eq("send_id", parent.id);
        if ((already ?? 0) > 0) {
          console.log(`  uid=${msg.uid} already recorded for send ${parent.id}, skip`);
          continue;
        }

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

  console.log(`\nDone. processed=${processed} matched=${matched} replies=${classified} bounces=${bounced}`);
})();
