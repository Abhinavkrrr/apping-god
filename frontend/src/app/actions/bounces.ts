"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

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
