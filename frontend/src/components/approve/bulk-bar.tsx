"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Send, Moon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { rejectSend } from "@/app/actions/approvals";
import { sendSelectedPending, scheduleSelectedForTomorrow } from "@/app/actions/send";

export function BulkBar({ selected, onClear }: { selected: string[]; onClear: () => void }) {
  const [busy, setBusy] = useState<"send" | "schedule" | "reject" | null>(null);
  const [isPending, startTransition] = useTransition();

  if (selected.length === 0) return null;

  function sendSelected() {
    if (!confirm(`Send ${selected.length} email(s) RIGHT NOW?\n\nEstimated time: ~${Math.ceil(selected.length * 6 / 60)} min with throttling jitter.\n\nCannot be undone.`)) return;
    setBusy("send");
    startTransition(async () => {
      toast.info(`Dispatching ${selected.length} emails...`);
      const r = await sendSelectedPending(selected);
      setBusy(null);
      if (r.ok) {
        toast.success(`✓ Sent: ${r.sent} · Failed: ${r.failed} · Skipped: ${r.skipped}`);
        onClear();
      } else {
        toast.error(r.error ?? "Send failed.");
      }
    });
  }

  function scheduleSelected() {
    if (!confirm(`Schedule ${selected.length} email(s) for tomorrow 10:30 AM IST?\n\nGitHub Actions cron will dispatch them autonomously.`)) return;
    setBusy("schedule");
    startTransition(async () => {
      const r = await scheduleSelectedForTomorrow(selected, { hour: 10, minute: 30 });
      setBusy(null);
      if (r.ok) {
        toast.success(`✓ Scheduled ${r.scheduled} for ${r.scheduled_at_local}`);
        onClear();
      } else {
        toast.error(r.error ?? "Schedule failed.");
      }
    });
  }

  function rejectAll() {
    if (!confirm(`Reject ${selected.length} drafts? They will not be sent.`)) return;
    setBusy("reject");
    startTransition(async () => {
      for (const id of selected) await rejectSend(id);
      setBusy(null);
      toast.success(`Rejected ${selected.length} drafts`);
      onClear();
    });
  }

  const disabled = isPending || busy !== null;

  return (
    <div className="sticky top-0 z-10 -mx-8 -mt-8 mb-4 px-8 py-3 bg-slate-900 text-white flex items-center justify-between flex-wrap gap-2">
      <div className="text-sm font-medium">{selected.length} selected</div>
      <div className="flex gap-2 flex-wrap">
        <Button variant="ghost" size="sm" className="text-white hover:bg-slate-800" onClick={onClear} disabled={disabled}>
          Clear
        </Button>
        <Button size="sm" onClick={rejectAll} disabled={disabled} className="bg-red-600 hover:bg-red-700">
          {busy === "reject"
            ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Rejecting…</>
            : <><Trash2 className="h-3.5 w-3.5 mr-1" /> Reject selected</>}
        </Button>
        <Button size="sm" onClick={scheduleSelected} disabled={disabled} className="bg-violet-500 hover:bg-violet-400">
          {busy === "schedule"
            ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Scheduling…</>
            : <><Moon className="h-3.5 w-3.5 mr-1" /> Schedule selected ({selected.length}) for 10:30 AM</>}
        </Button>
        <Button size="sm" onClick={sendSelected} disabled={disabled} className="bg-emerald-500 hover:bg-emerald-400">
          {busy === "send"
            ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Sending…</>
            : <><Send className="h-3.5 w-3.5 mr-1" /> Send selected ({selected.length})</>}
        </Button>
      </div>
    </div>
  );
}
