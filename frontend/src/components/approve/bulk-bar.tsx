"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { rejectSend } from "@/app/actions/approvals";
import { sendSelectedPending } from "@/app/actions/send";

export function BulkBar({ selected, onClear }: { selected: string[]; onClear: () => void }) {
  const [busy, setBusy] = useState<"send" | "reject" | null>(null);
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
    <div className="sticky top-0 z-10 -mx-8 -mt-8 mb-4 px-8 py-3 bg-slate-900 text-white flex items-center justify-between">
      <div className="text-sm font-medium">{selected.length} selected</div>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="text-white hover:bg-slate-800" onClick={onClear} disabled={disabled}>
          Clear
        </Button>
        <Button size="sm" onClick={rejectAll} disabled={disabled} className="bg-red-600 hover:bg-red-700">
          {busy === "reject"
            ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Rejecting…</>
            : <><Trash2 className="h-3.5 w-3.5 mr-1" /> Reject selected</>}
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
