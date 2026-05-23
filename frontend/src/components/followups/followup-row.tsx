"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendFollowupNow } from "@/app/actions/followups";

interface Thread {
  last_send_id: string;
  contact_name: string;
  contact_email: string;
  company_name: string;
  sent_at: string;
  days_since: number;
  highest_step: number;
  has_reply: boolean;
}

const STEP_LABEL = ["First touch sent", "Follow-up 1 sent", "Follow-up 2 sent", "Follow-up 3 sent", "All done"];

export function FollowupRow({
  thread, checked, onCheck, selectable,
}: {
  thread: Thread;
  checked: boolean;
  onCheck: (v: boolean) => void;
  selectable: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const nextStep = thread.highest_step + 1;
  const canFollowup = nextStep <= 3 && !thread.has_reply;

  function send() {
    if (!confirm(`Send follow-up ${nextStep} to ${thread.contact_email}?\n\nThis threads under the original email.`)) return;
    startTransition(async () => {
      const r = await sendFollowupNow(thread.last_send_id);
      if (r.ok) toast.success(`✓ Follow-up ${r.step} sent to ${r.sent_to}`);
      else toast.error(r.error ?? "Failed.");
    });
  }

  return (
    <div className="flex items-center gap-3 p-3 border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <input
        type="checkbox" checked={checked}
        onChange={(e) => onCheck(e.target.checked)}
        disabled={!selectable}
        className="h-4 w-4 rounded border-slate-300 disabled:opacity-30"
        title={selectable ? "Select for bulk action" : "No follow-up possible (replied or all done)"}
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">
          {thread.contact_name}{" "}
          <span className="text-slate-400 font-normal">&lt;{thread.contact_email}&gt;</span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span>{thread.company_name}</span>
          <span className="text-slate-300">·</span>
          <Badge variant={thread.highest_step === 0 ? "info" : "default"}>
            {STEP_LABEL[Math.min(thread.highest_step, 4)]}
          </Badge>
          <span className="text-slate-300">·</span>
          <span>{thread.days_since === 0 ? "today" : `${thread.days_since}d ago`}</span>
          {thread.has_reply && <Badge variant="success">Replied</Badge>}
        </div>
      </div>
      <Button
        size="sm" onClick={send} disabled={isPending || !canFollowup}
        title={!canFollowup ? (thread.has_reply ? "Already replied" : "All follow-ups sent") : `Send follow-up ${nextStep}`}
      >
        {isPending
          ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Sending…</>
          : canFollowup
            ? <><Send className="h-3.5 w-3.5 mr-1" /> Send follow-up {nextStep}</>
            : "—"}
      </Button>
    </div>
  );
}
