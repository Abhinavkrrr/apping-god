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
    if (!confirm(`Send ${pendingCount} email(s) RIGHT NOW?\n\nEach send takes ~6s with jitter to avoid Gmail throttling.\nEstimated total: ${Math.ceil(pendingCount * 6 / 60)} min.\n\nCannot be undone.`)) return;
    setBusy("send");
    startTransition(async () => {
      toast.info(`Dispatching ${pendingCount} emails... this will take a while.`);
      const r = await sendAllPendingNow();
      setBusy(null);
      if (r.ok) toast.success(`✓ Sent: ${r.sent} · Failed: ${r.failed} · Skipped: ${r.skipped}`);
      else toast.error(r.error ?? "Send failed.");
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
