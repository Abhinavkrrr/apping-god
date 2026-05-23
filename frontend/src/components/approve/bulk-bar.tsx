"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { rejectMany } from "@/app/actions/approvals";
import { sendSelectedPending } from "@/app/actions/send";
import { ScheduleDialog } from "./schedule-dialog";

export function BulkBar({ selected, onClear }: { selected: string[]; onClear: () => void }) {
  const [busy, setBusy] = useState<"send" | "reject" | null>(null);
  const [isPending, startTransition] = useTransition();

  if (selected.length === 0) return null;

  function sendSelected() {
    if (!confirm(`Send ${selected.length} email(s) RIGHT NOW?\n\nEstimated time: ~${Math.ceil(selected.length * 6 / 60)} min with throttling jitter.\n\nCannot be undone.`)) return;
    setBusy("send");
    startTransition(async () => {
      toast.info(`Dispatching ${selected.length} emails...`);
      const r = await sendSelectedPending(selected) as { ok: boolean; sent?: number; failed?: number; skipped?: number; error?: string };
      setBusy(null);
      if (r.ok) {
        toast.success(`✓ Sent: ${r.sent ?? 0} · Failed: ${r.failed ?? 0} · Skipped: ${r.skipped ?? 0}`);
        onClear();
      } else {
        toast.error(r.error ?? "Send failed.");
      }
    });
  }

  function rejectAll() {
    if (!confirm(`Reject ${selected.length} drafts? They will not be sent.`)) return;
    setBusy("reject");
    startTransition(async () => {
      const r = await rejectMany(selected);
      setBusy(null);
      if (r.ok) {
        toast.success(`Rejected ${r.count} drafts`);
        onClear();
      } else {
        toast.error(r.error ?? "Reject failed");
      }
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
        <ScheduleDialog
          triggerLabel={`Schedule selected (${selected.length})`}
          pendingCount={selected.length}
          selectedIds={selected}
          disabled={disabled}
          onDone={onClear}
        />
        <Button size="sm" onClick={sendSelected} disabled={disabled} className="bg-emerald-500 hover:bg-emerald-400">
          {busy === "send"
            ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Sending…</>
            : <><Send className="h-3.5 w-3.5 mr-1" /> Send selected ({selected.length})</>}
        </Button>
      </div>
    </div>
  );
}
