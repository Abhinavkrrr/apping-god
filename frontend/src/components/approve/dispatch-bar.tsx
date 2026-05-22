"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Send, Moon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendAllPendingNow, schedulePendingForTomorrow } from "@/app/actions/send";
import { GenerateModal } from "./generate-modal";
import { QuickAddModal } from "./quick-add-modal";

interface MasterTemplate {
  template_id: string;
  subject_tmpl: string;
  body_tmpl: string;
  eligible_contacts: number;
  total_contacts: number;
}

export function DispatchBar({
  pendingCount,
  master,
}: { pendingCount: number; master: MasterTemplate | null }) {
  const [busy, setBusy] = useState<"send" | "schedule" | null>(null);
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

  function handleSchedule() {
    if (pendingCount === 0) { toast.error("No pending drafts."); return; }
    if (!confirm(`Schedule ${pendingCount} email(s) to send tomorrow at 10:30 AM IST?`)) return;
    setBusy("schedule");
    startTransition(async () => {
      const r = await schedulePendingForTomorrow({ hour: 10, minute: 30 });
      setBusy(null);
      if (r.ok) toast.success(`✓ Scheduled ${r.scheduled} for ${r.scheduled_at_local}`);
      else toast.error(r.error ?? "Schedule failed.");
    });
  }

  const disabled = isPending || busy !== null;

  return (
    <div className="bg-slate-900 text-white rounded-lg p-4 -mx-1 mb-4 space-y-3">
      <div>
        <div className="font-semibold text-sm">Outreach controls</div>
        <div className="text-slate-300 text-xs mt-0.5">
          {pendingCount === 0
            ? master
              ? `No pending drafts. Click Generate to create one for each of your ${master.total_contacts} contacts.`
              : "No master template found. Check Templates page."
            : `${pendingCount} draft(s) ready. Send now or schedule for tomorrow morning.`}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-700">
        {master && <GenerateModal initial={master} mode="edit" />}
        {master && <GenerateModal initial={master} mode="generate" />}
        <QuickAddModal />

        <Button
          size="sm" onClick={handleSendNow} disabled={disabled || pendingCount === 0}
          className="bg-emerald-500 hover:bg-emerald-400 text-white border-0 ml-auto"
        >
          {busy === "send"
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</>
            : <><Send className="h-4 w-4 mr-2" /> Send NOW ({pendingCount})</>}
        </Button>

        <Button
          size="sm" onClick={handleSchedule} disabled={disabled || pendingCount === 0}
          className="bg-violet-500 hover:bg-violet-400 text-white border-0"
        >
          {busy === "schedule"
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scheduling…</>
            : <><Moon className="h-4 w-4 mr-2" /> Schedule for 10:30 AM tomorrow</>}
        </Button>
      </div>
    </div>
  );
}
