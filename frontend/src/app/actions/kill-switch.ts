"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

// Far-future timestamp used as the "killed" sentinel on accounts.paused_until.
// send-worker already checks paused_until > now() before using an account,
// so setting this to 2099 effectively disables every account.
const KILLED_UNTIL_ISO = "2099-12-31T23:59:59Z";

export interface KillSwitchStatus {
  killed: boolean;
  killed_since: string | null;       // ISO timestamp when paused_until was set
  paused_accounts: number;
  total_accounts: number;
  pending_approval_count: number;    // drafts currently in /approve queue
  approved_count: number;            // drafts currently scheduled for send
}

/** Read current kill-switch state by inspecting accounts.paused_until.
 * "Killed" = at least one account has paused_until in the far future
 * (the only way that happens is the kill switch was engaged). */
export async function getKillSwitchStatus(): Promise<KillSwitchStatus> {
  const sb = createAdminClient();

  const [{ data: accounts }, pendingRes, approvedRes] = await Promise.all([
    sb.from("accounts").select("paused_until"),
    sb.from("sends").select("id", { count: "exact", head: true })
      .eq("status", "pending_approval"),
    sb.from("sends").select("id", { count: "exact", head: true })
      .eq("status", "approved"),
  ]);

  const all = (accounts ?? []) as Array<{ paused_until: string | null }>;
  const totalAccounts = all.length;
  const now = new Date();
  const tomorrow = new Date(Date.now() + 86400_000);
  const pausedFarFuture = all.filter(a => a.paused_until && new Date(a.paused_until) > tomorrow);
  const pausedAccounts = pausedFarFuture.length;
  const killed = pausedAccounts > 0 && pausedAccounts === totalAccounts;

  // Use the earliest paused_until among killed accounts as "killed_since"
  // (approximates when the kill switch was engaged).
  const killed_since = killed
    ? pausedFarFuture
        .map(a => a.paused_until!)
        .sort()[0]
    : null;

  return {
    killed,
    killed_since,
    paused_accounts: pausedAccounts,
    total_accounts: totalAccounts,
    pending_approval_count: pendingRes.count ?? 0,
    approved_count: approvedRes.count ?? 0,
  };
}

/** Stop everything immediately. FOUR locks:
 *   1. Set paused_until = 2099 on every account (send-worker refuses to use any)
 *   2. Flip every status='approved' send back to status='pending_approval'
 *      and null out scheduled_at (cron dispatcher finds nothing to send)
 *   3. NULL OUT next_followup_at on every sent row — without this, the
 *      followup-daemon (runs every 15 min on pg_cron) would keep finding
 *      due follow-ups and generating fresh status='approved' sends,
 *      completely bypassing locks #1 and #2. The daemon itself also
 *      kill-switch checks now, but belt-AND-suspenders.
 *   4. Mirror in approvals table
 *
 * Does NOT delete data. Releasing the kill switch is non-destructive.
 *
 * NOTE: nulling next_followup_at means follow-ups WILL NOT auto-resume
 * after release. You'll need to manually re-schedule them — which is
 * the safer default after a panic stop.
 */
export async function engageKillSwitch(): Promise<{
  ok: boolean;
  accounts_paused: number;
  scheduled_cancelled: number;
  followups_disarmed: number;
  error?: string;
}> {
  const sb = createAdminClient();

  // 1. Pause every account
  const { data: pausedAcc, error: pErr } = await sb.from("accounts")
    .update({ paused_until: KILLED_UNTIL_ISO })
    .gte("id", "00000000-0000-0000-0000-000000000000")   // touches every row
    .select("id");
  if (pErr) return { ok: false, accounts_paused: 0, scheduled_cancelled: 0, followups_disarmed: 0, error: pErr.message };

  // 2. Convert all 'approved' (scheduled) sends back to pending_approval
  //    so the GH-Actions dispatcher has nothing to fire.
  const { data: cancelled, error: cErr } = await sb.from("sends")
    .update({ status: "pending_approval", scheduled_at: null })
    .eq("status", "approved")
    .select("id");
  if (cErr) {
    return { ok: false, accounts_paused: pausedAcc?.length ?? 0, scheduled_cancelled: 0, followups_disarmed: 0, error: cErr.message };
  }
  const cancelledIds = (cancelled ?? []).map((s: any) => s.id);

  // 3. DISARM the follow-up daemon by nulling next_followup_at on every
  //    sent row. The daemon's WHERE clause is `next_followup_at <= now()`,
  //    so null means "skip me forever". This is the lock that was missing
  //    before — without it, the daemon kept generating new approved sends
  //    every 15 min and your mails kept going out.
  const { data: disarmed, error: dErr } = await sb.from("sends")
    .update({ next_followup_at: null })
    .not("next_followup_at", "is", null)
    .select("id");
  if (dErr) {
    return { ok: false, accounts_paused: pausedAcc?.length ?? 0, scheduled_cancelled: cancelledIds.length, followups_disarmed: 0, error: dErr.message };
  }
  const disarmedCount = (disarmed ?? []).length;

  // 4. Mirror in approvals table — chunk in 100s to dodge the URL cap
  if (cancelledIds.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < cancelledIds.length; i += CHUNK) {
      const chunk = cancelledIds.slice(i, i + CHUNK);
      await sb.from("approvals")
        .update({ status: "pending", reviewed_at: null })
        .in("send_id", chunk);
    }
  }

  revalidatePath("/", "layout");  // force every page to re-render with new state
  return {
    ok: true,
    accounts_paused: pausedAcc?.length ?? 0,
    scheduled_cancelled: cancelledIds.length,
    followups_disarmed: disarmedCount,
  };
}

/** Release the kill switch. Unpauses every account. Does NOT auto-restart
 * any sends — the user has to deliberately re-approve drafts in /approve.
 * Safe default: never automatically resume sending after a panic-stop. */
export async function releaseKillSwitch(): Promise<{
  ok: boolean;
  accounts_unpaused: number;
  error?: string;
}> {
  const sb = createAdminClient();
  const tomorrow = new Date(Date.now() + 86400_000).toISOString();
  const { data: unpaused, error } = await sb.from("accounts")
    .update({ paused_until: null })
    .gt("paused_until", tomorrow)   // only un-pause the "killed" rows
    .select("id");
  if (error) return { ok: false, accounts_unpaused: 0, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, accounts_unpaused: unpaused?.length ?? 0 };
}
