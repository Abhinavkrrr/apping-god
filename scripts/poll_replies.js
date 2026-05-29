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
//
// Bounce notifications come from a frustrating variety of formats:
//   - Gmail: From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>
//            Subject: "Delivery Status Notification (...)"
//            Body: standard RFC-3464 DSN with Final-Recipient, Status, etc.
//   - Postfix (most ISPs): From: MAILER-DAEMON@<their-domain>
//            Subject: "Undelivered Mail Returned to Sender"
//            Body: "I'm sorry to have to inform you that your message could
//                   not be delivered" + "<email>: host smtp.X said:" + SMTP code
//   - Trend Micro / corporate filters: From: Mail Delivery System
//            <no-reply@tmes-in.trendmicro.com> — sender pattern doesn't say
//            "mailer-daemon" because the bounce was relayed through a filter.
//            Display name DOES say "Mail Delivery System" though.
//   - Exchange / Outlook: From: postmaster@<domain>
//            Subject: "Undeliverable: ..."
//
// Detection has to check sender ADDRESS + sender NAME + subject + body
// patterns + inline SMTP codes. Any one strong signal is enough.
// ─────────────────────────────────────────────────────────────────

// Address-or-display-name patterns that say "I am a mail-delivery daemon".
// Tested against BOTH envelope.from[0].address and envelope.from[0].name
// (lowercased) because relays often hide the daemon address but keep the
// display name.
const DAEMON_RE = /(mailer[-\s]?daemon|postmaster|mail[-\s.]delivery|mail[-\s.]system|delivery[-\s.]status|delivery[-\s.]notification|mail[-\s.]?gateway|email[-\s.]delivery)/i;

// Subject patterns. "RE: <original subj>" is intentionally NOT here — many
// bounces just thread under the original subject (per the user's screenshot).
const BOUNCE_SUBJECT_RE = /(delivery status notification|undeliverable|undelivered|delivery failure|delivery incomplete|delivery has failed|returned mail|mail delivery failed|message not delivered|failure notice|returned to sender)/i;

// Body phrases that are dead-giveaway bounce content.
const BOUNCE_BODY_RE = new RegExp([
  "this is an automatically generated delivery status notification",
  "i'?m sorry to have to inform you that your message could not be delivered",
  "your message (?:wasn'?t|could not be|was not) delivered",
  "your message did not reach",
  "delivery to the following recipient(?:s)? (?:has been |)?failed",
  "the following address(?:es)? failed",
  "delivery has failed to these recipients",
  "this message was created automatically by mail delivery software",
  "could not deliver your message",
  "address(?:es)? listed below could not be reached",
].join("|"), "i");

// Inline SMTP failure codes — covers "550 5.1.1", "550-5.1.1", "554-5.7.1",
// bare "550", and "Code: 550". Only counted as bounce when paired with
// failure-context words to avoid false-positives on, say, someone quoting
// HTTP status 550 in casual email.
const SMTP_CODE_RE = /\b(5\d{2}|4\d{2})[\s-]?(?:\d\.\d+\.\d+)?\b/;
const FAILURE_CONTEXT_RE = /\b(deliver|reject|undeliver|bounc|user (?:unknown|does not exist)|account.*does not exist|address (?:not found|rejected|invalid)|mailbox (?:full|unavailable|not found)|no such (?:user|recipient|address)|recipient (?:rejected|unknown|address rejected))/i;

function isBounce(envelope, body) {
  const fromAddr = (envelope?.from?.[0]?.address ?? "").toLowerCase();
  const fromName = (envelope?.from?.[0]?.name ?? "").toLowerCase();
  const subj     = envelope?.subject ?? "";

  // 1. Daemon-like sender (address OR display name)
  if (DAEMON_RE.test(fromAddr)) return true;
  if (DAEMON_RE.test(fromName)) return true;

  // 2. Bounce-specific subject line
  if (BOUNCE_SUBJECT_RE.test(subj)) return true;

  // 3. Dead-giveaway body phrases
  if (BOUNCE_BODY_RE.test(body)) return true;

  // 4. Inline SMTP failure code WITH failure-context phrase nearby
  if (SMTP_CODE_RE.test(body) && FAILURE_CONTEXT_RE.test(body)) return true;

  // 5. Postfix-format inline recipient: "<user@domain>: host X.com said:"
  if (/<[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}>\s*:\s*host\s+\S+(?:\[[\d.]+\])?\s+said:/i.test(body)) return true;

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
  // ── 1. Failed recipient ─────────────────────────────────────────
  // Try strongest signals first; fall back to weaker ones.
  let failed_recipient = null;
  let m =
       body.match(/Final-Recipient:\s*(?:rfc822;\s*)?([^\s<>\r\n;]+@[^\s<>\r\n;]+)/i)
    ?? body.match(/Original-Recipient:\s*(?:rfc822;\s*)?([^\s<>\r\n;]+@[^\s<>\r\n;]+)/i)
    // Postfix-style:  "<user@domain>: host smtp.X.com said:"
    ?? body.match(/<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>\s*:\s*host\s+\S+/i)
    // Generic mention near "to:" / "recipient:" / "for:"
    ?? body.match(/(?:to|recipient|for)\s*[:\s]\s*<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i)
    // Last resort: just find any address that's NOT ours
    ?? body.match(/<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/i);
  if (m) failed_recipient = m[1].trim().toLowerCase();

  // ── 2. SMTP status code ─────────────────────────────────────────
  let smtp_status = null;
  // Strongest: standard DSN header "Status: X.Y.Z"
  m = body.match(/Status:\s*(\d\.\d+\.\d+)/i);
  if (m) smtp_status = m[1];
  // Next: inline "550 5.1.1" or "550-5.1.1" (Postfix smtp.X.com said: format)
  if (!smtp_status) {
    m = body.match(/\b(?:5\d{2}|4\d{2})[\s-](\d\.\d+\.\d+)/);
    if (m) smtp_status = m[1];
  }
  // Last: just a 3-digit SMTP code → infer X.0.0 from first digit
  if (!smtp_status) {
    m = body.match(/\b(5\d{2}|4\d{2})\b/);
    if (m) smtp_status = `${m[1][0]}.0.0`;
  }

  // ── 3. Diagnostic message (the human-readable reason) ───────────
  let diagnostic = null;
  m = body.match(/Diagnostic-Code:\s*(?:smtp;\s*)?([^\r\n]+)/i)
   ?? body.match(/(?:response was|the reason was|said|reason)\s*[:\s]\s*([^\r\n]+)/i)
   // Postfix often prints the diagnostic right after the SMTP code
   ?? body.match(/(?:5\d{2}|4\d{2})[\s-](?:\d\.\d+\.\d+\s+)?([^\r\n<]+)/i);
  if (m) {
    diagnostic = m[1].trim().replace(/\s+/g, " ");
    if (diagnostic.length > 500) diagnostic = diagnostic.slice(0, 500);
  }

  // ── 4. DSN action: failed / delayed / delivered ─────────────────
  const actionMatch = body.match(/Action:\s*(failed|delayed|delivered)/i);
  const action = actionMatch ? actionMatch[1].toLowerCase() : null;

  // ── 5. Classify hard vs soft ────────────────────────────────────
  let bounce_type = "unknown";
  if (smtp_status) {
    if (smtp_status.startsWith("5")) bounce_type = "hard";
    else if (smtp_status.startsWith("4")) bounce_type = "soft";
  }
  if (bounce_type === "unknown" && action === "failed")  bounce_type = "hard";
  if (bounce_type === "unknown" && action === "delayed") bounce_type = "soft";

  // Body-keyword classification (catches bounces with no status code at all)
  if (bounce_type === "unknown") {
    if (/(?:email account .*does not exist|address (?:not found|does not exist|rejected|invalid)|user unknown|no such user|no such recipient|account .*has been (?:disabled|suspended|closed)|user (?:doesn'?t exist|is unknown))/i.test(body)) {
      bounce_type = "hard";
    } else if (/(?:temporary|will retry|mailbox full|over quota|timed out|deferred|temporary failure|try again later|grey-?listed|throttled)/i.test(body)) {
      bounce_type = "soft";
    }
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

          // Stop ALL future sends to this contact + remove them entirely.
          // (User requirement: "if an email bounces then never again send
          // it to it..remove it from the application as well")
          //
          // Order matters:
          //   1. Cancel pending/approved sends FIRST (cascades to approvals)
          //   2. Audit-log the bounce as an event (FK on events is to send_id,
          //      not contact_id, so this survives contact deletion)
          //   3. Look up contact email (need it for unsubscribes table)
          //   4. Add email to unsubscribes — prevents re-import via CSV /
          //      Quick Add / Discover from ever re-creating this contact
          //   5. DELETE the contact — cascades sends/events/replies via FK,
          //      but bounces.contact_id is ON DELETE SET NULL (migration
          //      20260527000002) so the bounce record survives with the
          //      failed_recipient + diagnostic preserved for audit.
          if (parent.contact_id) {
            // 1. Cancel pipeline
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

            // 2. Audit event
            await sb.from("events").insert({
              send_id: parent.id, type: "bounce",
              metadata: {
                bounce_type: parsed.bounce_type,
                smtp_status: parsed.smtp_status,
                failed_recipient: parsed.failed_recipient,
                cancelled_sends: cancelled?.length ?? 0,
              },
            });

            // 3. Get the contact's email (need it for unsubscribes)
            const { data: contact } = await sb.from("contacts")
              .select("email").eq("id", parent.contact_id).maybeSingle();
            const email = (contact?.email ?? parsed.failed_recipient ?? "").toLowerCase().trim();

            // 4. Permanent block via unsubscribes (survives contact re-import)
            if (email && email.includes("@")) {
              await sb.from("unsubscribes").upsert({
                email,
                reason: `bounce_${parsed.bounce_type}`,
              }, { onConflict: "email" });
            }

            // 5. Delete the contact — removes from /contacts UI, blocks all
            // future generateDrafts (the contact pool is `contacts` itself).
            // bounces.contact_id flips to NULL via SET NULL FK.
            await sb.from("contacts").delete().eq("id", parent.contact_id);
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
