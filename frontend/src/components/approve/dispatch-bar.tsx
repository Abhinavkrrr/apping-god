"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendAllPendingNow } from "@/app/actions/send";
import { GenerateModal, type CampaignTemplate } from "./generate-modal";
import { QuickAddModal } from "./quick-add-modal";
import { ScheduleDialog } from "./schedule-dialog";

export function DispatchBar({
  pendingCount,
  campaigns,
}: {
  pendingCount: number;
  campaigns: CampaignTemplate[];
}) {
  const [busy, setBusy] = useState<"send" | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSendNow() {
    if (pendingCount === 0) { toast.error("No pending drafts."); return; }
    const drainMin = Math.ceil(pendingCount * 6 / 60);
    if (!confirm(
      `Queue ${pendingCount} draft(s) for IMMEDIATE cloud dispatch?\n\n` +
      `→ Cloud cron picks them up within 15 minutes\n` +
      `→ First send fires shortly after, then ~6 sec apart (jitter to avoid Gmail throttling)\n` +
      `→ Full batch drains in ~${drainMin} min total\n\n` +
      `Safe to close your laptop the moment you click OK — sending continues in the cloud.\n\n` +
      `Cannot be undone.`
    )) return;
    setBusy("send");
    startTransition(async () => {
      const r = await sendAllPendingNow();
      setBusy(null);
      if (r.ok) {
        const skippedStr = r.skipped ? ` · ${r.skipped} skipped (no email / unsubscribed)` : "";
        toast.success(
          `✓ ${r.queued} queued for cloud dispatch${skippedStr}.\nSafe to close laptop.`,
          { duration: 8000 }
        );
      } else toast.error(r.error ?? "Queue failed.");
    });
  }

  const disabled = isPending || busy !== null;
  const totalEligible = campaigns.reduce((s, c) => s + c.eligible_contacts, 0);

  return (
    <div className="bg-slate-900 text-white rounded-lg p-4 -mx-1 mb-4 space-y-3">
      <div>
        <div className="font-semibold text-sm flex items-center gap-2">
          Outreach controls
          {campaigns.length > 1 && (
            <span className="text-[10px] font-normal text-slate-300 bg-slate-800 px-2 py-0.5 rounded">
              {campaigns.length} campaigns active
            </span>
          )}
        </div>
        <div className="text-slate-300 text-xs mt-0.5">
          {pendingCount === 0
            ? campaigns.length === 0
              ? "No active campaigns. Activate one in Campaigns settings."
              : `No pending drafts. Click Generate to create drafts (${totalEligible} contacts eligible across ${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}).`
            : `${pendingCount} draft(s) ready. Send now or schedule for tomorrow morning.`}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-700">
        {campaigns.length > 0 && <GenerateModal campaigns={campaigns} mode="edit" />}
        {campaigns.length > 0 && <GenerateModal campaigns={campaigns} mode="generate" />}
        <QuickAddModal campaigns={campaigns} />

        <Button
          size="sm" onClick={handleSendNow} disabled={disabled || pendingCount === 0}
          className="bg-emerald-500 hover:bg-emerald-400 text-white border-0 ml-auto"
        >
          {busy === "send"
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</>
            : <><Send className="h-4 w-4 mr-2" /> Send NOW ({pendingCount})</>}
        </Button>

        <ScheduleDialog
          triggerLabel={`Schedule (${pendingCount})`}
          pendingCount={pendingCount}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
