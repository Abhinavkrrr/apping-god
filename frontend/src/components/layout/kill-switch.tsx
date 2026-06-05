"use client";

import { useState, useTransition, useEffect } from "react";
import { Loader2, OctagonAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { engageKillSwitch, releaseKillSwitch, getKillSwitchStatus, type KillSwitchStatus } from "@/app/actions/kill-switch";

export function KillSwitchPanel() {
  const [status, setStatus] = useState<KillSwitchStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTrans] = useTransition();

  // Poll on mount + every 30s so the badge stays in sync with reality
  // even if state changed in another tab or via SQL.
  async function refresh() {
    try {
      const s = await getKillSwitchStatus();
      setStatus(s);
    } catch (e) {
      console.warn("[killswitch] status fetch failed:", e);
    }
  }
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, []);

  function handleKill() {
    if (!confirm(
      "ENGAGE KILL SWITCH?\n\n" +
      "This will:\n" +
      "  1. Pause every Gmail account (send-worker refuses to use any)\n" +
      "  2. Cancel every scheduled send (flipped to pending_approval)\n" +
      "  3. DISARM every follow-up (next_followup_at → NULL) so the\n" +
      "     follow-up daemon stops generating new sends every 15 min\n" +
      "  4. No new emails go out — anywhere, any campaign — until released\n\n" +
      "Releasing the switch later does NOT auto-restart sends OR follow-ups.\n" +
      "You'll need to manually re-approve drafts AND re-schedule follow-ups.\n\n" +
      "Engage now?"
    )) return;

    setBusy(true);
    startTrans(async () => {
      const r = await engageKillSwitch();
      setBusy(false);
      if (r.ok) {
        toast.error(
          `🛑 KILL SWITCH ENGAGED — ${r.accounts_paused} account(s) paused, ${r.scheduled_cancelled} scheduled send(s) cancelled, ${r.followups_disarmed} follow-up(s) disarmed.`,
          { duration: 15000 }
        );
        await refresh();
      } else {
        toast.error(r.error ?? "Failed to engage kill switch.");
      }
    });
  }

  function handleRelease() {
    if (!confirm(
      "RELEASE the kill switch?\n\n" +
      "This will un-pause every Gmail account. New sends will be possible,\n" +
      "BUT no sends will automatically resume — every cancelled scheduled\n" +
      "send was flipped to pending_approval and now requires manual approval.\n\n" +
      "Proceed?"
    )) return;

    setBusy(true);
    startTrans(async () => {
      const r = await releaseKillSwitch();
      setBusy(false);
      if (r.ok) {
        toast.success(
          `✓ Kill switch released — ${r.accounts_unpaused} account(s) un-paused.\nNo sends auto-resumed; re-approve in /approve to send.`,
          { duration: 12000 }
        );
        await refresh();
      } else {
        toast.error(r.error ?? "Failed to release kill switch.");
      }
    });
  }

  // While first status loads, render a small placeholder so layout doesn't jump.
  if (!status) {
    return (
      <div className="px-3 py-2 text-[10px] text-slate-400 flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading status…
      </div>
    );
  }

  if (status.killed) {
    return (
      <button
        type="button"
        onClick={handleRelease}
        disabled={busy}
        className="mx-3 mb-2 rounded-md border-2 border-red-500 bg-red-600 hover:bg-red-700 text-white px-3 py-2 transition-colors disabled:opacity-50 animate-pulse"
        title={`Kill switch engaged since ${status.killed_since ? new Date(status.killed_since).toLocaleString() : "?"}. ${status.paused_accounts}/${status.total_accounts} accounts paused. Click to release.`}
      >
        <div className="flex items-center gap-2">
          {busy
            ? <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            : <OctagonAlert className="h-4 w-4 shrink-0" />}
          <div className="text-left flex-1">
            <div className="text-xs font-bold uppercase tracking-wide">KILL SWITCH ON</div>
            <div className="text-[10px] opacity-90">
              {status.paused_accounts}/{status.total_accounts} accounts paused · click to release
            </div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleKill}
      disabled={busy}
      className="mx-3 mb-2 rounded-md border border-slate-300 bg-white hover:bg-red-50 hover:border-red-400 hover:text-red-700 text-slate-700 px-3 py-2 transition-colors disabled:opacity-50"
      title={`Active: ${status.total_accounts} account(s), ${status.approved_count} scheduled send(s), ${status.pending_approval_count} pending. Click to PAUSE EVERYTHING immediately.`}
    >
      <div className="flex items-center gap-2">
        {busy
          ? <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          : <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />}
        <div className="text-left flex-1">
          <div className="text-xs font-semibold">System active</div>
          <div className="text-[10px] text-slate-500">
            click to KILL all sends
          </div>
        </div>
      </div>
    </button>
  );
}
