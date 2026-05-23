"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cancelScheduledSend } from "@/app/actions/send";

interface Props {
  row: {
    id: string;
    contact_name: string;
    contact_email: string;
    company_name: string;
    rendered_subject: string;
    scheduled_at: string;
  };
  checked: boolean;
  onCheck: (v: boolean) => void;
}

const istFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "short", day: "numeric", month: "short",
  hour: "2-digit", minute: "2-digit", hour12: true,
});

export function ScheduledRow({ row, checked, onCheck }: Props) {
  const [isPending, startTransition] = useTransition();
  const scheduled = new Date(row.scheduled_at);
  const now = Date.now();
  const inFuture = scheduled.getTime() > now;
  const hoursAway = (scheduled.getTime() - now) / 3600_000;

  function cancel() {
    if (!confirm(`Cancel scheduled send to ${row.contact_email}?\n\nIt will be moved back to the Approve queue as a pending draft.`)) return;
    startTransition(async () => {
      const r = await cancelScheduledSend(row.id);
      if (r.ok) toast.success(`✓ Cancelled — back in Approve queue`);
      else toast.error(r.error ?? "Failed.");
    });
  }

  return (
    <div className="flex items-center gap-3 p-3 border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <input
        type="checkbox" checked={checked}
        onChange={(e) => onCheck(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300"
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">
          {row.contact_name}{" "}
          <span className="text-slate-400 font-normal">&lt;{row.contact_email}&gt;</span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {row.company_name} · <span className="line-clamp-1 inline">{row.rendered_subject}</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-medium text-slate-700">{istFmt.format(scheduled)}</div>
        <div className="text-[10px] text-slate-500">
          {inFuture
            ? hoursAway < 1 ? `in ${Math.round(hoursAway * 60)} min`
              : hoursAway < 24 ? `in ${hoursAway.toFixed(1)} hr`
              : `in ${Math.round(hoursAway / 24)} days`
            : <Badge variant="warning" className="text-[9px]">overdue</Badge>}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={cancel} disabled={isPending}>
        {isPending
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <><XCircle className="h-3.5 w-3.5 mr-1 text-red-600" /> Cancel</>}
      </Button>
    </div>
  );
}
