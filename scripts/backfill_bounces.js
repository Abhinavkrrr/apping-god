// One-off backfill: scan the replies table for entries that are actually
// bounces (sender = mailer-daemon / postmaster), re-route them into the
// bounces table, mark each affected contact as bounced, and cancel any
// still-pending or scheduled sends to those contacts.
//
//   node scripts/backfill_bounces.js [--dry-run]
//
// Safe to re-run — bounces table has a (send_id, smtp_status, day) unique
// index so duplicates won't accumulate.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

const dryRun = process.argv.includes("--dry-run");

const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com", port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
};

// ─── Bounce parsing (kept in sync with poll_replies.js — same regexes) ───
function parseBounce(body) {
  let failed_recipient = null;
  let m =
       body.match(/Final-Recipient:\s*(?:rfc822;\s*)?([^\s<>\r\n;]+@[^\s<>\r\n;]+)/i)
    ?? body.match(/Original-Recipient:\s*(?:rfc822;\s*)?([^\s<>\r\n;]+@[^\s<>\r\n;]+)/i)
    ?? body.match(/<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>\s*:\s*host\s+\S+/i)
    ?? body.match(/(?:to|recipient|for)\s*[:\s]\s*<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i)
    ?? body.match(/<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/i);
  if (m) failed_recipient = m[1].trim().toLowerCase();

  let smtp_status = null;
  m = body.match(/Status:\s*(\d\.\d+\.\d+)/i);
  if (m) smtp_status = m[1];
  if (!smtp_status) {
    m = body.match(/\b(?:5\d{2}|4\d{2})[\s-](\d\.\d+\.\d+)/);
    if (m) smtp_status = m[1];
  }
  if (!smtp_status) {
    m = body.match(/\b(5\d{2}|4\d{2})\b/);
    if (m) smtp_status = `${m[1][0]}.0.0`;
  }

  let diagnostic = null;
  m = body.match(/Diagnostic-Code:\s*(?:smtp;\s*)?([^\r\n]+)/i)
   ?? body.match(/(?:response was|the reason was|said|reason)\s*[:\s]\s*([^\r\n]+)/i)
   ?? body.match(/(?:5\d{2}|4\d{2})[\s-](?:\d\.\d+\.\d+\s+)?([^\r\n<]+)/i);
  if (m) {
    diagnostic = m[1].trim().replace(/\s+/g, " ");
    if (diagnostic.length > 500) diagnostic = diagnostic.slice(0, 500);
  }

  const actionMatch = body.match(/Action:\s*(failed|delayed|delivered)/i);
  const action = actionMatch ? actionMatch[1].toLowerCase() : null;

  let bounce_type = "unknown";
  if (smtp_status) {
    if (smtp_status.startsWith("5")) bounce_type = "hard";
    else if (smtp_status.startsWith("4")) bounce_type = "soft";
  }
  if (bounce_type === "unknown" && action === "failed")  bounce_type = "hard";
  if (bounce_type === "unknown" && action === "delayed") bounce_type = "soft";
  if (bounce_type === "unknown") {
    if (/(?:email account .*does not exist|address (?:not found|does not exist|rejected|invalid)|user unknown|no such user|no such recipient|account .*has been (?:disabled|suspended|closed)|user (?:doesn'?t exist|is unknown))/i.test(body)) {
      bounce_type = "hard";
    } else if (/(?:temporary|will retry|mailbox full|over quota|timed out|deferred|temporary failure|try again later|grey-?listed|throttled)/i.test(body)) {
      bounce_type = "soft";
    }
  }
  return { failed_recipient, smtp_status, bounce_type, diagnostic };
}

(async () => {
  const c = new Client(POOLER);
  await c.connect();
  console.log(`${dryRun ? "[DRY-RUN] " : ""}Scanning replies for bounces…`);

  // Detection mirrors poll_replies.js isBounce(): match sender daemon
  // patterns, OR characteristic body phrases / SMTP failure codes (catches
  // bounces relayed through corporate filters like Trend Micro where the
  // sender is no-reply@tmes-in.trendmicro.com instead of mailer-daemon).
  const { rows } = await c.query(`
    SELECT r.id, r.send_id, r.from_email, r.raw_body, r.received_at,
           s.contact_id
    FROM replies r
    JOIN sends s ON s.id = r.send_id
    WHERE
         -- daemon-like sender
         r.from_email ~* '(mailer-?daemon|postmaster|mail[-.\\s]?delivery|mail[-.\\s]?system|delivery[-.\\s]?(status|notification)|email[-.\\s]?delivery)'
      OR -- Postfix / Trend Micro classic body phrases
         r.raw_body ~* 'i.{0,2}m sorry to have to inform you that your message could not be delivered'
      OR r.raw_body ~* 'this is an automatically generated delivery status notification'
      OR r.raw_body ~* 'your message (wasn|could not be|was not) (be |)delivered'
      OR r.raw_body ~* 'delivery to the following recipient.{0,10}failed'
      OR r.raw_body ~* '<[^>]+>\\s*:\\s*host\\s+\\S+.{0,40}said:'
      OR -- inline SMTP failure code with failure context (550-5.1.1, 550 5.7.1, etc.)
         (r.raw_body ~ '\\m(5[0-9]{2}|4[0-9]{2})[ -][0-9]\\.[0-9]+\\.[0-9]+\\M'
          AND r.raw_body ~* '(deliver|reject|undeliver|user (unknown|does not exist)|account.*does not exist|address (not found|rejected|invalid)|mailbox (full|unavailable)|no such (user|recipient))')
    ORDER BY r.received_at DESC
  `);
  console.log(`Found ${rows.length} bounce-pattern entries in replies table.`);

  let migrated = 0, skipped = 0, contactsBlocked = 0, sendsCancelled = 0;
  const contactIdsBounced = new Set();

  for (const r of rows) {
    const parsed = parseBounce(r.raw_body ?? "");

    if (dryRun) {
      console.log(`  ${parsed.bounce_type.toUpperCase().padEnd(7)} ${parsed.failed_recipient ?? "?"} status=${parsed.smtp_status ?? "?"} send=${r.send_id}`);
      migrated++;
      continue;
    }

    // Idempotent: bounces has (send_id, smtp_status, day) unique index
    try {
      await c.query(`
        INSERT INTO bounces (send_id, contact_id, bounce_type, failed_recipient,
                             smtp_status, diagnostic, from_daemon, raw_body, received_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT DO NOTHING
      `, [
        r.send_id, r.contact_id, parsed.bounce_type, parsed.failed_recipient,
        parsed.smtp_status, parsed.diagnostic, r.from_email, r.raw_body,
        r.received_at,
      ]);
      migrated++;
    } catch (e) {
      console.warn(`  ⚠ insert failed for send ${r.send_id}: ${e.message}`);
      skipped++;
      continue;
    }

    // Block the contact (any bounce — hard or soft — preserves sender rep)
    if (r.contact_id) {
      const skipReason = parsed.bounce_type === "hard" ? "hard_bounce" : "soft_bounce";
      await c.query(`
        UPDATE contacts SET email_status='bounced', skip_reason=$2
        WHERE id=$1 AND (skip_reason IS NULL OR skip_reason != $2)
      `, [r.contact_id, skipReason]);
      contactIdsBounced.add(r.contact_id);

      // Cancel anything in the pipeline
      const cancelRes = await c.query(`
        UPDATE sends SET status='skipped',
                         failure_reason='Contact bounced (backfilled)'
        WHERE contact_id=$1 AND status IN ('pending_approval','approved')
        RETURNING id
      `, [r.contact_id]);
      if (cancelRes.rowCount > 0) {
        await c.query(`UPDATE approvals SET status='skipped' WHERE send_id = ANY($1::uuid[])`,
          [cancelRes.rows.map(x => x.id)]);
        sendsCancelled += cancelRes.rowCount;
      }
    }
  }
  contactsBlocked = contactIdsBounced.size;

  if (!dryRun) {
    // Now that everything is in bounces, remove the mailer-daemon entries
    // from replies so /inbox stops showing them as "replies".
    const delRes = await c.query(`
      DELETE FROM replies
      WHERE from_email ~* '(mailer-daemon|postmaster|mail-delivery)'
    `);
    console.log(`\n✓ Removed ${delRes.rowCount} mailer-daemon rows from replies.`);
  }

  console.log(`\n── Backfill summary ──`);
  console.table([{
    "rows scanned": rows.length,
    "migrated to bounces": migrated,
    "skipped (errors)": skipped,
    "contacts blocked": contactsBlocked,
    "sends cancelled": sendsCancelled,
    "dry-run?": dryRun,
  }]);

  await c.end();
})();
