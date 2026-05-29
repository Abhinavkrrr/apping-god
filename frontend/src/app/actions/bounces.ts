"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

// ─────────────────────────────────────────────────────────────
// Bounce-detection regexes — MUST stay in sync with scripts/poll_replies.js
// (intentionally duplicated; this file is JS-runtime, that one is node)
// ─────────────────────────────────────────────────────────────
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
  "address not found",
].join("|"), "i");
const SMTP_CODE_RE = /\b(5\d{2}|4\d{2})[\s-]?(?:\d\.\d+\.\d+)?\b/;
const FAILURE_CONTEXT_RE = /\b(deliver|reject|undeliver|bounc|user (?:unknown|does not exist)|account.*does not exist|address (?:not found|rejected|invalid)|mailbox (?:full|unavailable|not found)|no such (?:user|recipient|address)|recipient (?:rejected|unknown|address rejected))/i;
const POSTFIX_HOST_SAID_RE = /<[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}>\s*:\s*host\s+\S+(?:\[[\d.]+\])?\s+said:/i;

function isBounceLike(from_email: string, raw_body: string): boolean {
  if (DAEMON_RE.test(from_email || "")) return true;
  if (BOUNCE_BODY_RE.test(raw_body || "")) return true;
  if (SMTP_CODE_RE.test(raw_body || "") && FAILURE_CONTEXT_RE.test(raw_body || "")) return true;
  if (POSTFIX_HOST_SAID_RE.test(raw_body || "")) return true;
  return false;
}

interface ParsedBounce {
  failed_recipient: string | null;
  smtp_status: string | null;
  bounce_type: "hard" | "soft" | "unknown";
  diagnostic: string | null;
}

function parseBounceBody(body: string): ParsedBounce {
  let failed_recipient: string | null = null;
  let m: RegExpMatchArray | null =
       body.match(/Final-Recipient:\s*(?:rfc822;\s*)?([^\s<>\r\n;]+@[^\s<>\r\n;]+)/i)
    ?? body.match(/Original-Recipient:\s*(?:rfc822;\s*)?([^\s<>\r\n;]+@[^\s<>\r\n;]+)/i)
    ?? body.match(/<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>\s*:\s*host\s+\S+/i)
    ?? body.match(/(?:to|recipient|for)\s*[:\s]\s*<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i)
    ?? body.match(/<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/i);
  if (m) failed_recipient = m[1].trim().toLowerCase();

  let smtp_status: string | null = null;
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

  let diagnostic: string | null = null;
  m = body.match(/Diagnostic-Code:\s*(?:smtp;\s*)?([^\r\n]+)/i)
   ?? body.match(/(?:response was|the reason was|said|reason)\s*[:\s]\s*([^\r\n]+)/i)
   ?? body.match(/(?:5\d{2}|4\d{2})[\s-](?:\d\.\d+\.\d+\s+)?([^\r\n<]+)/i);
  if (m) {
    diagnostic = m[1].trim().replace(/\s+/g, " ");
    if (diagnostic.length > 500) diagnostic = diagnostic.slice(0, 500);
  }

  let bounce_type: "hard" | "soft" | "unknown" = "unknown";
  if (smtp_status) {
    if (smtp_status.startsWith("5")) bounce_type = "hard";
    else if (smtp_status.startsWith("4")) bounce_type = "soft";
  }
  if (bounce_type === "unknown") {
    if (/(?:email account .*does not exist|address (?:not found|does not exist|rejected|invalid)|user unknown|no such user|no such recipient|account .*has been (?:disabled|suspended|closed)|user (?:doesn'?t exist|is unknown))/i.test(body)) {
      bounce_type = "hard";
    } else if (/(?:temporary|will retry|mailbox full|over quota|timed out|deferred|temporary failure|try again later|grey-?listed|throttled)/i.test(body)) {
      bounce_type = "soft";
    }
  }
  return { failed_recipient, smtp_status, bounce_type, diagnostic };
}

/** Check whether the bounces table exists AND is visible to PostgREST.
 * Returns a 3-state result so the dashboard can show the right error:
 *   'ok'           — table exists and is queryable
 *   'missing'      — table doesn't exist in Postgres at all (run migration)
 *   'cache_stale'  — table exists but PostgREST hasn't reloaded its schema
 *                    cache yet (one-liner SQL fix: NOTIFY pgrst, 'reload schema';) */
export async function bouncesTableStatus(): Promise<"ok" | "missing" | "cache_stale"> {
  const sb = createAdminClient();
  const { error } = await sb.from("bounces").select("id", { count: "exact", head: true });
  if (!error) return "ok";

  const msg = (error.message || "").toLowerCase();
  const code = (error as any).code;

  // PostgREST returns PGRST205 + this exact phrasing when the table was
  // created post-startup and the schema cache hasn't refreshed yet.
  if (code === "PGRST205" || msg.includes("could not find the table") || msg.includes("schema cache")) {
    return "cache_stale";
  }

  // PostgreSQL "relation does not exist" (42P01) — the table really isn't there.
  if (code === "42P01" || msg.includes("does not exist")) return "missing";

  // Anything else (RLS, network, etc.) — treat as missing so the user gets
  // the most informative banner with the full migration option.
  return "missing";
}

/** Legacy boolean wrapper — kept for backward compatibility, returns true
 * for both 'ok' and 'cache_stale' since the table physically exists. */
export async function bouncesTableExists(): Promise<boolean> {
  const s = await bouncesTableStatus();
  return s === "ok" || s === "cache_stale";
}

export interface PotentialBounce {
  reply_id: string;
  send_id: string | null;
  contact_id: string | null;
  from_email: string;
  received_at: string;
  contact_name: string;
  contact_email: string;
  company_name: string;
  campaign_name: string;
  parsed: ParsedBounce;
}

/** Scan the replies table for messages that LOOK like bounces (matching the
 * same patterns as poll_replies.js) but never got migrated to the bounces
 * table — usually because they arrived before bounce detection existed, or
 * because the bounces table itself didn't exist yet when they landed. */
export async function listPotentialBounces(): Promise<PotentialBounce[]> {
  const sb = createAdminClient();
  const { data } = await sb.from("replies").select(`
    id, send_id, from_email, raw_body, received_at,
    sends(contact_id, campaigns(name), contacts(first_name, last_name, email, companies(name)))
  `).order("received_at", { ascending: false }).limit(1000);

  const out: PotentialBounce[] = [];
  for (const r of (data ?? []) as any[]) {
    if (!isBounceLike(r.from_email ?? "", r.raw_body ?? "")) continue;
    const parsed = parseBounceBody(r.raw_body ?? "");
    const c = r.sends?.contacts;
    out.push({
      reply_id: r.id,
      send_id: r.send_id,
      contact_id: r.sends?.contact_id ?? null,
      from_email: r.from_email ?? "",
      received_at: r.received_at,
      contact_name: c ? [c.first_name, c.last_name].filter(Boolean).join(" ") || "—" : "—",
      contact_email: c?.email ?? parsed.failed_recipient ?? "—",
      company_name: c?.companies?.name ?? "—",
      campaign_name: r.sends?.campaigns?.name ?? "—",
      parsed,
    });
  }
  return out;
}

/** Migrate every bounce-pattern reply into the bounces table. For each:
 *   - INSERT into bounces (ON CONFLICT DO NOTHING — idempotent)
 *   - UPDATE the contact: email_status='bounced', skip_reason='hard/soft_bounce'
 *   - CANCEL any still-pending/approved sends to that contact
 *   - DELETE the reply row (it shouldn't have been there)
 * Returns a structured result so the UI can surface errors clearly (esp. if
 * the bounces table doesn't exist yet — common first-time situation). */
export async function migratePotentialBounces(): Promise<{
  ok: boolean;
  migrated?: number;
  contacts_blocked?: number;
  sends_cancelled?: number;
  error?: string;
  error_code?: "TABLE_MISSING" | "CACHE_STALE" | "OTHER";
}> {
  const sb = createAdminClient();

  // Detect the two setup-time failure modes up-front so the UI shows the
  // exact one-liner needed instead of a confusing generic insert error.
  const status = await bouncesTableStatus();
  if (status === "missing") {
    return {
      ok: false,
      error_code: "TABLE_MISSING",
      error: "The bounces table doesn't exist in your database yet. Run the migration SQL in Supabase SQL Editor first.",
    };
  }
  if (status === "cache_stale") {
    return {
      ok: false,
      error_code: "CACHE_STALE",
      error: "The bounces table exists but Supabase's REST cache hasn't reloaded yet. Run `NOTIFY pgrst, 'reload schema';` in SQL Editor once, then retry.",
    };
  }

  const potential = await listPotentialBounces();
  if (potential.length === 0) {
    return { ok: true, migrated: 0, contacts_blocked: 0, sends_cancelled: 0 };
  }

  let migrated = 0, sendsCancelled = 0;
  const contactsBlockedSet = new Set<string>();

  for (const p of potential) {
    // Insert bounce row (idempotent via the unique index in the migration)
    const { error: insErr } = await sb.from("bounces").insert({
      send_id: p.send_id,
      contact_id: p.contact_id,
      bounce_type: p.parsed.bounce_type,
      failed_recipient: p.parsed.failed_recipient,
      smtp_status: p.parsed.smtp_status,
      diagnostic: p.parsed.diagnostic,
      from_daemon: p.from_email,
      raw_body: null,    // raw_body lives in replies until we delete that row
      received_at: p.received_at,
    });
    if (insErr) {
      const msg = (insErr.message || "").toLowerCase();
      const code = (insErr as any).code;
      // Duplicate-key from the (send_id, smtp_status, day) unique index — fine on re-runs
      if (msg.includes("duplicate")) {
        // count as migrated since the row IS there
      } else if (code === "PGRST205" || msg.includes("could not find the table") || msg.includes("schema cache")) {
        // Schema cache went stale mid-loop (e.g. another deploy). Tell user how to fix.
        return {
          ok: false, error_code: "CACHE_STALE",
          error: "Supabase REST cache went stale during migration. Run `NOTIFY pgrst, 'reload schema';` in SQL Editor then retry.",
        };
      } else {
        return { ok: false, error_code: "OTHER", error: `Insert failed: ${insErr.message}` };
      }
    }

    // Block the contact (preserves Gmail sender rep — agent stops sending)
    if (p.contact_id) {
      const skipReason = p.parsed.bounce_type === "hard" ? "hard_bounce" : "soft_bounce";
      await sb.from("contacts").update({
        email_status: "bounced",
        skip_reason: skipReason,
      }).eq("id", p.contact_id);
      contactsBlockedSet.add(p.contact_id);

      // Cancel any still-pending/scheduled sends for this contact
      const { data: cancelled } = await sb.from("sends").update({
        status: "skipped",
        failure_reason: `Contact bounced (${p.parsed.bounce_type})`,
      })
        .eq("contact_id", p.contact_id)
        .in("status", ["pending_approval", "approved"])
        .select("id");
      if (cancelled && cancelled.length > 0) {
        await sb.from("approvals").update({ status: "skipped" })
          .in("send_id", cancelled.map(c => c.id));
        sendsCancelled += cancelled.length;
      }
    }

    // Finally remove the row from replies so /inbox stops showing it
    await sb.from("replies").delete().eq("id", p.reply_id);
    migrated++;
  }

  revalidatePath("/bounces");
  revalidatePath("/inbox");
  revalidatePath("/approve");
  revalidatePath("/contacts");
  return { ok: true, migrated, contacts_blocked: contactsBlockedSet.size, sends_cancelled: sendsCancelled };
}

export interface BounceRow {
  id: string;
  send_id: string | null;
  contact_id: string | null;
  bounce_type: "hard" | "soft" | "unknown";
  failed_recipient: string | null;
  smtp_status: string | null;
  diagnostic: string | null;
  from_daemon: string | null;
  received_at: string;
  // joined
  contact_name: string;
  contact_email: string;
  company_name: string;
  campaign_name: string;
  contact_skip_reason: string | null;  // 'hard_bounce' | 'soft_bounce' | null (restored)
}

export async function listBounces(opts: { filter?: "all" | "hard" | "soft" } = {}): Promise<{
  bounces: BounceRow[];
  stats: {
    total: number;
    hard: number;
    soft: number;
    unknown: number;
    contacts_blocked: number;
  };
}> {
  const sb = createAdminClient();

  let q = sb.from("bounces").select(`
    id, send_id, contact_id, bounce_type, failed_recipient, smtp_status,
    diagnostic, from_daemon, received_at,
    sends(campaigns(name)),
    contacts(first_name, last_name, email, skip_reason, companies(name))
  `).order("received_at", { ascending: false }).limit(500);

  if (opts.filter === "hard") q = q.eq("bounce_type", "hard");
  else if (opts.filter === "soft") q = q.eq("bounce_type", "soft");

  const { data } = await q;
  const bounces: BounceRow[] = ((data ?? []) as any[]).map(b => ({
    id: b.id,
    send_id: b.send_id,
    contact_id: b.contact_id,
    bounce_type: b.bounce_type,
    failed_recipient: b.failed_recipient,
    smtp_status: b.smtp_status,
    diagnostic: b.diagnostic,
    from_daemon: b.from_daemon,
    received_at: b.received_at,
    contact_name: [b.contacts?.first_name, b.contacts?.last_name].filter(Boolean).join(" ") || "—",
    contact_email: b.contacts?.email ?? b.failed_recipient ?? "—",
    company_name: b.contacts?.companies?.name ?? "—",
    campaign_name: b.sends?.campaigns?.name ?? "—",
    contact_skip_reason: b.contacts?.skip_reason ?? null,
  }));

  // Stats — separate aggregate query (cheap)
  const { data: agg } = await sb.from("bounces")
    .select("bounce_type, contact_id");
  const stats = {
    total: agg?.length ?? 0,
    hard: agg?.filter((a: any) => a.bounce_type === "hard").length ?? 0,
    soft: agg?.filter((a: any) => a.bounce_type === "soft").length ?? 0,
    unknown: agg?.filter((a: any) => a.bounce_type === "unknown").length ?? 0,
    contacts_blocked: new Set((agg ?? []).map((a: any) => a.contact_id).filter(Boolean)).size,
  };

  return { bounces, stats };
}

/** Manually un-bounce a contact — clears skip_reason and email_status so the
 * agent will resume sending to them. Use sparingly: a hard bounce means the
 * address is dead, so restoring it usually just gets you another bounce. */
export async function restoreContact(contactId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = createAdminClient();
  const { error } = await sb.from("contacts").update({
    email_status: "unverified",
    skip_reason: null,
  }).eq("id", contactId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/bounces");
  revalidatePath("/contacts");
  revalidatePath("/approve");
  return { ok: true };
}

/** Permanently delete a bounce record (audit log cleanup). Doesn't touch
 * the underlying contact — use restoreContact for that. */
export async function deleteBounceRecord(bounceId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = createAdminClient();
  const { error } = await sb.from("bounces").delete().eq("id", bounceId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/bounces");
  return { ok: true };
}
