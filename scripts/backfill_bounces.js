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

// ─── Bounce parsing (duplicated from poll_replies.js so this script is standalone) ───
function parseBounce(body) {
  const recipMatch = body.match(/Final-Recipient:\s*rfc822;\s*([^\s<>\r\n]+)/i)
    ?? body.match(/Original-Recipient:\s*rfc822;\s*([^\s<>\r\n]+)/i)
    ?? body.match(/(?:to|recipient).{0,40}?:\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  const failed_recipient = recipMatch ? recipMatch[1].trim().toLowerCase() : null;

  const statusMatch = body.match(/Status:\s*(\d\.\d+\.\d+)/i);
  const smtp_status = statusMatch ? statusMatch[1] : null;

  const diagMatch = body.match(/Diagnostic-Code:\s*([^\r\n]+)/i)
    ?? body.match(/(?:response was|reason):\s*([^\r\n]+)/i);
  let diagnostic = diagMatch ? diagMatch[1].trim() : null;
  if (diagnostic && diagnostic.length > 500) diagnostic = diagnostic.slice(0, 500);

  const actionMatch = body.match(/Action:\s*(failed|delayed|delivered)/i);
  const action = actionMatch ? actionMatch[1].toLowerCase() : null;

  let bounce_type = "unknown";
  if (smtp_status) {
    if (smtp_status.startsWith("5.")) bounce_type = "hard";
    else if (smtp_status.startsWith("4.")) bounce_type = "soft";
  }
  if (bounce_type === "unknown" && action === "failed") bounce_type = "hard";
  if (bounce_type === "unknown" && action === "delayed") bounce_type = "soft";
  if (bounce_type === "unknown" && /address (not found|does not exist|rejected)|user unknown|no such user/i.test(body)) {
    bounce_type = "hard";
  } else if (bounce_type === "unknown" && /temporary|will retry|mailbox full|timed out|deferred/i.test(body)) {
    bounce_type = "soft";
  }
  return { failed_recipient, smtp_status, bounce_type, diagnostic };
}

(async () => {
  const c = new Client(POOLER);
  await c.connect();
  console.log(`${dryRun ? "[DRY-RUN] " : ""}Scanning replies for bounces…`);

  const { rows } = await c.query(`
    SELECT r.id, r.send_id, r.from_email, r.raw_body, r.received_at,
           s.contact_id
    FROM replies r
    JOIN sends s ON s.id = r.send_id
    WHERE r.from_email ~* '(mailer-daemon|postmaster|mail-delivery)'
    ORDER BY r.received_at DESC
  `);
  console.log(`Found ${rows.length} mailer-daemon entries in replies table.`);

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
