// Quick offline test: feed the bounce parser the body + envelope from
// the user's Trend Micro screenshot and confirm it now classifies as a
// bounce + extracts the right recipient, status, and diagnostic.
//
//   node scripts/test_bounce_detection.js
//
// No DB or network — pure regex check.

// Pull in the detector by re-requiring the script's exports… but
// poll_replies.js is a top-level IIFE so we can't import it cleanly.
// Inline the functions here (kept in sync with poll_replies.js).

const DAEMON_RE = /(mailer[-\s]?daemon|postmaster|mail[-\s.]delivery|mail[-\s.]system|delivery[-\s.]status|delivery[-\s.]notification|mail[-\s.]?gateway|email[-\s.]delivery)/i;
const BOUNCE_SUBJECT_RE = /(delivery status notification|undeliverable|undelivered|delivery failure|delivery incomplete|delivery has failed|returned mail|mail delivery failed|message not delivered|failure notice|returned to sender)/i;
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
const SMTP_CODE_RE = /\b(5\d{2}|4\d{2})[\s-]?(?:\d\.\d+\.\d+)?\b/;
const FAILURE_CONTEXT_RE = /\b(deliver|reject|undeliver|bounc|user (?:unknown|does not exist)|account.*does not exist|address (?:not found|rejected|invalid)|mailbox (?:full|unavailable|not found)|no such (?:user|recipient|address)|recipient (?:rejected|unknown|address rejected))/i;

function isBounce(envelope, body) {
  const fromAddr = (envelope?.from?.[0]?.address ?? "").toLowerCase();
  const fromName = (envelope?.from?.[0]?.name ?? "").toLowerCase();
  const subj     = envelope?.subject ?? "";
  if (DAEMON_RE.test(fromAddr)) return { hit: true, by: "daemon-address" };
  if (DAEMON_RE.test(fromName)) return { hit: true, by: "daemon-display-name" };
  if (BOUNCE_SUBJECT_RE.test(subj)) return { hit: true, by: "subject" };
  if (BOUNCE_BODY_RE.test(body)) return { hit: true, by: "body-phrase" };
  if (SMTP_CODE_RE.test(body) && FAILURE_CONTEXT_RE.test(body)) return { hit: true, by: "smtp-code+context" };
  if (/<[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}>\s*:\s*host\s+\S+(?:\[[\d.]+\])?\s+said:/i.test(body)) return { hit: true, by: "postfix-host-said" };
  return { hit: false };
}

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

  let bounce_type = "unknown";
  if (smtp_status) {
    if (smtp_status.startsWith("5")) bounce_type = "hard";
    else if (smtp_status.startsWith("4")) bounce_type = "soft";
  }
  if (bounce_type === "unknown") {
    if (/(?:email account .*does not exist|address (?:not found|does not exist|rejected|invalid)|user unknown|no such user|no such recipient|account .*has been (?:disabled|suspended|closed))/i.test(body)) bounce_type = "hard";
    else if (/(?:temporary|will retry|mailbox full|over quota|timed out|deferred|temporary failure|try again later)/i.test(body)) bounce_type = "soft";
  }
  return { failed_recipient, smtp_status, bounce_type, diagnostic };
}

// ─── TEST CASES ───────────────────────────────────────────────────

const cases = [
  {
    name: "Trend Micro relay (user's screenshot — Money View / Bhavya)",
    envelope: {
      from: [{ name: "Mail Delivery System", address: "no-reply@tmes-in.trendmicro.com" }],
      subject: "Exploring Internship Roles in Product Management / Founder's Office / AI at Money View",
    },
    body: `I'm sorry to have to inform you that your message could not
be delivered to one or more recipients. It's attached below.

For further assistance, please send mail to postmaster.

If you do so, please include this problem report. You can
delete your own text from the attached returned message.

       The mail system

<bhavya.shree@moneyview.in>: host smtp.google.com[192.178.211.27] said:
    550-5.1.1 The email account that you tried to reach does not exist. Please
    try 550-5.1.1 double-checking the recipient's email address for typos or
    550-5.1.1 unnecessary spaces. For more information, go to 550 5.1.1
    https://support.google.com/mail/?p=NoSuchUser
    d2e1a72fcca58-84214d2d4fdsi1907469b3a.219 - gsmtp (in reply to RCPT TO command)`,
    expect: { hit: true, recipient: "bhavya.shree@moneyview.in", status: "5.1.1", type: "hard" },
  },
  {
    name: "Classic Gmail mailer-daemon DSN (soft bounce, delay)",
    envelope: {
      from: [{ name: "Mail Delivery Subsystem", address: "mailer-daemon@googlemail.com" }],
      subject: "Delivery Status Notification (Delay)",
    },
    body: `This is an automatically generated Delivery Status Notification.

THIS IS A WARNING MESSAGE ONLY.
YOU DO NOT NEED TO RESEND YOUR MESSAGE.

Delivery to the following recipient has been delayed:

    karthik@leadangels.in

Final-Recipient: rfc822; karthik@leadangels.in
Action: delayed
Status: 4.4.7
Diagnostic-Code: smtp; Domain leadangels.in temporarily failed`,
    expect: { hit: true, recipient: "karthik@leadangels.in", status: "4.4.7", type: "soft" },
  },
  {
    name: "Real reply (NOT a bounce) — should NOT trigger",
    envelope: {
      from: [{ name: "Bhavya Shree", address: "bhavya.shree@moneyview.in" }],
      subject: "RE: Exploring Internship Roles in Product Management",
    },
    body: `Hi Abhinav,

Thanks for reaching out! Could we hop on a quick call next Tuesday at 3pm?

Best,
Bhavya`,
    expect: { hit: false },
  },
];

let pass = 0, fail = 0;
for (const t of cases) {
  const detected = isBounce(t.envelope, t.body);
  const parsed = detected.hit ? parseBounce(t.body) : null;
  const ok = detected.hit === t.expect.hit
    && (!t.expect.hit || (parsed?.failed_recipient === t.expect.recipient
                          && parsed?.smtp_status === t.expect.status
                          && parsed?.bounce_type === t.expect.type));
  console.log(`\n${ok ? "✓ PASS" : "✗ FAIL"}  ${t.name}`);
  console.log(`  Detected: ${detected.hit ? `YES (via ${detected.by})` : "no"}`);
  if (parsed) {
    console.log(`  Parsed:   recipient=${parsed.failed_recipient}  status=${parsed.smtp_status}  type=${parsed.bounce_type}`);
    console.log(`  Diag:     ${(parsed.diagnostic ?? "").slice(0, 100)}…`);
  }
  if (!ok) {
    console.log(`  Expected: hit=${t.expect.hit} recipient=${t.expect.recipient ?? "-"} status=${t.expect.status ?? "-"} type=${t.expect.type ?? "-"}`);
    fail++;
  } else pass++;
}
console.log(`\n── ${pass} passed, ${fail} failed ──`);
process.exit(fail === 0 ? 0 : 1);
