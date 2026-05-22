// Email sender — picks an active Gmail account, SMTPs the message,
// attaches the campaign's resume, logs event(sent).
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const nodemailer = require("nodemailer");
const { getSupabase } = require("./supabase");

/**
 * Picks the next-best sending account from the pool.
 * For v1: prefer the .env GMAIL_USER if accounts table is empty.
 */
async function pickAccount() {
  const sb = getSupabase();
  const { data: accounts } = await sb
    .from("accounts")
    .select("*")
    .in("warmup_phase", ["warmup", "active"])
    .order("sent_today", { ascending: true });

  if (accounts && accounts.length > 0) {
    // Choose first available under cap
    const eligible = accounts.find(a =>
      a.sent_today < a.daily_cap &&
      (!a.paused_until || new Date(a.paused_until) <= new Date())
    );
    return eligible || accounts[0];
  }

  // Fallback: virtual account from .env (Phase 2 bootstrap)
  return {
    id: null,
    email: process.env.GMAIL_USER,
    _smtp_password: process.env.GMAIL_APP_PASSWORD,
    daily_cap: parseInt(process.env.DAILY_CAP_PER_ACCOUNT || "35", 10),
    sent_today: 0,
    warmup_phase: "active",
  };
}

function buildTransport(account) {
  // For v1, decryption isn't wired — pull from env or use raw password.
  const pass = account._smtp_password || process.env.GMAIL_APP_PASSWORD;
  // Port 587 with STARTTLS — works on networks that block 465 (most college/home ISPs).
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: account.email, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

/**
 * Download the resume PDF from Supabase Storage for attachment.
 */
async function fetchResumeBuffer(resumeId) {
  if (!resumeId) return null;
  const sb = getSupabase();
  const { data: resume } = await sb.from("resumes").select("*").eq("id", resumeId).single();
  if (!resume) return null;
  const { data, error } = await sb.storage.from("resumes").download(resume.storage_path);
  if (error) {
    console.warn(`  [resume] download failed: ${error.message}`);
    return null;
  }
  const buf = Buffer.from(await data.arrayBuffer());
  return {
    filename: resume.storage_path.split("/").pop().replace(/^default-\d+-/, ""),
    content: buf,
    contentType: "application/pdf",
  };
}

/**
 * Send one message and log the event.
 * @param {object} opts
 * @param {string} opts.to            – recipient email
 * @param {string} opts.subject       – fully-rendered subject
 * @param {string} opts.textBody      – plain-text body (raw, no footer)
 * @param {string} opts.htmlBody      – HTML body (with pixel + footer)
 * @param {string} [opts.sendId]      – sends.id for event logging (optional for dry tests)
 * @param {string} [opts.resumeId]    – resumes.id to attach
 * @param {string} [opts.inReplyTo]   – Message-ID of the parent (for threading follow-ups)
 * @param {string} [opts.references]  – References header for threading
 */
async function sendEmail(opts) {
  const sb = getSupabase();
  const account = await pickAccount();
  if (!account.email) throw new Error("No sending account available.");

  const transport = buildTransport(account);
  const attachment = await fetchResumeBuffer(opts.resumeId);

  const senderName = process.env.SENDER_NAME || "Abhinav Kumar";
  const headers = {};
  if (opts.inReplyTo) headers["In-Reply-To"] = opts.inReplyTo;
  if (opts.references) headers["References"] = opts.references;
  if (opts.sendId) headers["X-Apping-Send-Id"] = opts.sendId;

  const info = await transport.sendMail({
    from: `"${senderName}" <${account.email}>`,
    to: opts.to,
    subject: opts.subject,
    text: opts.textBody,
    html: opts.htmlBody,
    attachments: attachment ? [attachment] : [],
    headers,
  });

  // Log event(sent)
  if (opts.sendId) {
    await sb.from("events").insert({
      send_id: opts.sendId,
      type: "sent",
      metadata: { account: account.email, message_id: info.messageId, response: info.response },
    });
    await sb.from("sends").update({
      sent_at: new Date().toISOString(),
      message_id: info.messageId,
      status: "sent",
    }).eq("id", opts.sendId);

    // Bump account counter
    if (account.id) {
      await sb.from("accounts").update({
        sent_today: account.sent_today + 1,
      }).eq("id", account.id);
    }
  }

  return {
    accepted: info.accepted,
    rejected: info.rejected,
    messageId: info.messageId,
    response: info.response,
    fromAccount: account.email,
    attachedResume: !!attachment,
  };
}

module.exports = { sendEmail, pickAccount, fetchResumeBuffer };
