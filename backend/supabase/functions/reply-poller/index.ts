// Reply poller — polls Gmail IMAP for new replies and classifies them via Groq.
//
// For v1: uses the single GMAIL_USER from env (single-account mode).
// Phase-4 production: iterates over accounts table.
//
// Schedule: every 2 min via pg_cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImapFlow } from "https://esm.sh/imapflow@1.0.171";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const CLASSIFY_SYSTEM = `Classify the email reply into exactly one category:
- positive: interested, wants to chat, asking for time
- negative: not interested, declined, "no thanks"
- out_of_office: OOO / vacation / parental leave auto-reply
- auto_reply: thank-you-for-email autoresponder, ticket created, etc.
- question: asking a specific question that needs human response
- other: anything else
Respond with ONLY the category word, nothing else.`;

async function classify(body: string): Promise<string> {
  if (!GROQ_API_KEY || !body) return "other";
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
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
  } catch {
    return "other";
  }
}

Deno.serve(async () => {
  const sb = admin();

  // Track last-seen UID per inbox (stored in accounts.imap_last_uid).
  // For v1 single-account: use GMAIL_USER as the key. Create the row with
  // the REAL password (not a placeholder) so send-worker can use it too.
  let { data: account } = await sb.from("accounts").select("*").eq("email", GMAIL_USER).maybeSingle();
  if (!account) {
    const ins = await sb.from("accounts").insert({
      email: GMAIL_USER,
      smtp_password_enc: GMAIL_APP_PASSWORD,
      imap_password_enc: GMAIL_APP_PASSWORD,
      warmup_phase: "active",
    }).select().single();
    account = ins.data;
  } else if (account.smtp_password_enc === "ENV" || !account.smtp_password_enc) {
    // Heal an older row that was created with a placeholder.
    await sb.from("accounts").update({
      smtp_password_enc: GMAIL_APP_PASSWORD,
      imap_password_enc: GMAIL_APP_PASSWORD,
    }).eq("id", account.id);
  }
  const lastUid = account?.imap_last_uid ?? 0;

  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    logger: false,
  });

  let processed = 0, classified = 0;
  let newestUid = lastUid;

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const range = lastUid > 0 ? `${lastUid + 1}:*` : "1:*";
      for await (const msg of client.fetch(range, {
        uid: true, envelope: true, source: true, internalDate: true,
      }, { uid: true })) {
        processed++;
        if (msg.uid && msg.uid > newestUid) newestUid = msg.uid;

        // Match reply via In-Reply-To header
        const inReplyTo = msg.envelope?.inReplyTo as string | undefined;
        if (!inReplyTo) continue;
        const { data: parent } = await sb.from("sends")
          .select("id").eq("message_id", inReplyTo).maybeSingle();
        if (!parent) continue;

        // Decode body
        const raw = msg.source?.toString("utf8") ?? "";
        const bodyMatch = raw.match(/\r?\n\r?\n([\s\S]+)/);
        const body = bodyMatch ? bodyMatch[1].slice(0, 4000) : raw.slice(0, 4000);
        const fromEmail = (msg.envelope?.from as any)?.[0]?.address ?? "";

        const classification = await classify(body);
        classified++;

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

        // STOP sequence on any meaningful reply
        if (classification !== "auto_reply" && classification !== "out_of_office") {
          await sb.from("sends").update({ next_followup_at: null }).eq("id", parent.id);
        }
        if (classification === "out_of_office") {
          // pause 7 days
          const pause = new Date(Date.now() + 7 * 86400_000).toISOString();
          await sb.from("sends").update({ next_followup_at: pause }).eq("id", parent.id);
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false, error: e instanceof Error ? e.message : String(e),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  if (account?.id && newestUid > lastUid) {
    await sb.from("accounts").update({ imap_last_uid: newestUid }).eq("id", account.id);
  }

  return new Response(JSON.stringify({
    ok: true, processed, classified, last_uid: newestUid,
  }), { headers: { "Content-Type": "application/json" } });
});
