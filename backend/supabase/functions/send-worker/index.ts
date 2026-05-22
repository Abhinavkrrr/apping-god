// Send-worker Edge Function (Deno runtime).
//
// Modes:
//   POST { to, subject, text_body, html_body, resume_id? }      → direct send (CLI test path)
//   POST { send_id }                                             → fetch from DB + send (scheduler path, Phase 3+)
//
// Returns JSON: { ok, message_id, accepted, from_account, attached_resume }
//
// Auth: requires Supabase service-role JWT as Bearer (verify_jwt=true).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;
const SENDER_NAME = Deno.env.get("SENDER_NAME") ?? "Abhinav Kumar";
const SENDER_PHYSICAL_ADDRESS =
  Deno.env.get("SENDER_PHYSICAL_ADDRESS") ?? "IIT Bombay, Mumbai, India";
const TRACKING_BASE_URL =
  (Deno.env.get("TRACKING_BASE_URL") ?? "").replace(/\/$/, "");
const IIT_LOGO_URL = Deno.env.get("IIT_LOGO_URL") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Tracking injection ──────────────────────────────────────────────
function trackPixel(sendId: string) {
  return `${TRACKING_BASE_URL}/t/open/${sendId}.gif`;
}
function trackClick(sendId: string, target: string) {
  return `${TRACKING_BASE_URL}/t/click/${sendId}?u=${encodeURIComponent(target)}`;
}
function trackUnsub(sendId: string) {
  return `${TRACKING_BASE_URL}/t/unsub/${sendId}`;
}

function plainToTrackedHtml(plainBody: string, sendId: string): string {
  const escaped = plainBody
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const linked = escaped.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    (url) =>
      `<a href="${trackClick(sendId, url)}" style="color:#0366d6">${url}</a>`,
  );

  // Markdown-style bold: **word** → <strong>word</strong>
  const bolded = linked.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");

  const withBreaks = bolded.replace(/\n/g, "<br>\n");

  const logoBlock = IIT_LOGO_URL
    ? `<br><br><img src="${IIT_LOGO_URL}" alt="IIT Bombay" width="110" height="110" style="display:block;border:0;margin-top:8px" />`
    : "";

  // No unsubscribe footer (per user preference - personal outreach feel).
  const pixel = `<img src="${trackPixel(sendId)}" width="1" height="1" alt="" style="display:block;border:0" />`;

  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${withBreaks}${logoBlock}${pixel}</div>`;
}

function plainWithFooter(plainBody: string, _sendId: string): string {
  return plainBody;
}

// ── Resume fetch from Supabase Storage ──────────────────────────────
async function fetchResume(resumeId: string) {
  const sb = admin();
  const { data: resume } = await sb.from("resumes").select("*").eq("id", resumeId).single();
  if (!resume) return null;

  const { data, error } = await sb.storage.from("resumes").download(resume.storage_path);
  if (error || !data) return null;

  const buf = new Uint8Array(await data.arrayBuffer());
  const filename = resume.storage_path.split("/").pop()?.replace(/^default-\d+-/, "") ?? "resume.pdf";
  return { filename, content: buf, contentType: "application/pdf" };
}

// ── Main handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  // Direct send path (used by CLI test)
  const to = body.to as string | undefined;
  const subject = body.subject as string | undefined;
  const textBody = body.text_body as string | undefined;
  const htmlBody = body.html_body as string | undefined;
  const resumeId = body.resume_id as string | undefined;
  const logSendId = body.log_send_id as string | undefined;
  const inReplyTo = body.in_reply_to as string | undefined;
  const references = body.references as string | undefined;

  if (!to || !subject || !textBody || !htmlBody) {
    return jsonResponse(
      { error: "missing required: to, subject, text_body, html_body" },
      400,
    );
  }

  // Optional resume attachment
  let attachment: { filename: string; content: Uint8Array; contentType: string } | null = null;
  if (resumeId) {
    attachment = await fetchResume(resumeId);
  }

  // Pick a sending account: prefer one from the accounts table that isn't
  // paused, isn't dead, is under daily cap, and has a REAL password (not
  // a placeholder like "ENV"). Fall back to env GMAIL_USER otherwise.
  const sb = admin();
  const { data: pool } = await sb.from("accounts").select("*")
    .in("warmup_phase", ["warmup", "active"])
    .order("sent_today", { ascending: true });

  const isRealPassword = (p: string | null | undefined) =>
    !!p && p !== "ENV" && p.length >= 8;

  const eligible = (pool ?? []).find((a: any) =>
    isRealPassword(a.smtp_password_enc) &&
    a.sent_today < a.daily_cap &&
    (!a.paused_until || new Date(a.paused_until) <= new Date())
  );
  const senderEmail = eligible?.email ?? GMAIL_USER;
  const senderPassword = eligible?.smtp_password_enc ?? GMAIL_APP_PASSWORD;
  const senderAccountId = eligible?.id ?? null;

  // SMTP send via denomailer. Port 465 SSL.
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: senderEmail, password: senderPassword },
    },
  });

  const headers: Record<string, string> = {};
  if (inReplyTo) headers["In-Reply-To"] = inReplyTo;
  if (references) headers["References"] = references;
  if (logSendId) headers["X-Apping-Send-Id"] = logSendId;

  try {
    const messageId = `<${crypto.randomUUID()}@${senderEmail.split("@")[1] ?? "gmail.com"}>`;
    headers["Message-ID"] = messageId;

    await client.send({
      from: `${SENDER_NAME} <${senderEmail}>`,
      to,
      subject,
      content: textBody,
      html: htmlBody,
      headers,
      attachments: attachment
        ? [
            {
              filename: attachment.filename,
              content: attachment.content,
              contentType: attachment.contentType,
              encoding: "binary" as const,
            },
          ]
        : [],
    });

    await client.close();

    // Log event(sent) + bump account counter
    if (logSendId) {
      await sb.from("events").insert({
        send_id: logSendId,
        type: "sent",
        metadata: { account: senderEmail, message_id: messageId },
      });
      await sb.from("sends").update({
        sent_at: new Date().toISOString(),
        message_id: messageId,
        account_id: senderAccountId,
        status: "sent",
      }).eq("id", logSendId);
    }
    if (senderAccountId && eligible) {
      // Bump the account's daily counter
      await sb.from("accounts").update({
        sent_today: (eligible.sent_today ?? 0) + 1,
      }).eq("id", senderAccountId);
    }

    return jsonResponse({
      ok: true,
      message_id: messageId,
      from_account: senderEmail,
      to,
      attached_resume: !!attachment,
      attached_filename: attachment?.filename ?? null,
    });
  } catch (e) {
    try { await client.close(); } catch (_) { /* ignore */ }
    return jsonResponse(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      500,
    );
  }
});

// Re-export tracking helpers so the CLI side can render the same way.
export { plainToTrackedHtml, plainWithFooter };
