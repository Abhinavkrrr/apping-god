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

  const withBreaks = linked.replace(/\n/g, "<br>\n");

  const footer = `<br><br>
<p style="font-size:11px;color:#9ca3af;line-height:1.4;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px">
${SENDER_PHYSICAL_ADDRESS}<br>
<a href="${trackUnsub(sendId)}" style="color:#9ca3af">Unsubscribe</a>
</p>`;

  const pixel = `<img src="${trackPixel(sendId)}" width="1" height="1" alt="" style="display:block;border:0" />`;

  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${withBreaks}${footer}${pixel}</div>`;
}

function plainWithFooter(plainBody: string, sendId: string): string {
  return `${plainBody}\n\n---\n${SENDER_PHYSICAL_ADDRESS}\nUnsubscribe: ${trackUnsub(sendId)}\n`;
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

  // SMTP send
  // Use port 587 with STARTTLS — Supabase Edge Functions allow outbound on both 465 & 587.
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
    },
  });

  const headers: Record<string, string> = {};
  if (inReplyTo) headers["In-Reply-To"] = inReplyTo;
  if (references) headers["References"] = references;
  if (logSendId) headers["X-Apping-Send-Id"] = logSendId;

  try {
    const messageId = `<${crypto.randomUUID()}@${GMAIL_USER.split("@")[1] ?? "gmail.com"}>`;
    headers["Message-ID"] = messageId;

    await client.send({
      from: `${SENDER_NAME} <${GMAIL_USER}>`,
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

    // Log event(sent) if log_send_id provided
    if (logSendId) {
      const sb = admin();
      await sb.from("events").insert({
        send_id: logSendId,
        type: "sent",
        metadata: { account: GMAIL_USER, message_id: messageId },
      });
      await sb.from("sends").update({
        sent_at: new Date().toISOString(),
        message_id: messageId,
        status: "sent",
      }).eq("id", logSendId);
    }

    return jsonResponse({
      ok: true,
      message_id: messageId,
      from_account: GMAIL_USER,
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
