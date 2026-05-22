"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { Moon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  schedulePendingForTomorrow, scheduleSelectedForTomorrow,
} from "@/app/actions/send";

/** Build "YYYY-MM-DD" for tomorrow in IST. */
function defaultDate(): string {
  const now = new Date();
  const istNow = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  istNow.setUTCDate(istNow.getUTCDate() + 1);
  return istNow.toISOString().slice(0, 10);
}

/** Convert a date string + IST time string ("HH:MM") to a UTC ISO timestamp. */
function istToUtcIso(dateStr: string, timeStr: string): string {
  const [h, m] = timeStr.split(":").map(n => parseInt(n, 10));
  const [y, mo, d] = dateStr.split("-").map(n => parseInt(n, 10));
  // IST = UTC + 5:30 → subtract 5h 30m to get UTC
  const utcDate = new Date(Date.UTC(y, mo - 1, d, h - 5, m - 30, 0));
  return utcDate.toISOString();
}

interface Props {
  triggerLabel: string;        // e.g. "Schedule (511)" or "Schedule selected (5)"
  triggerClass?: string;
  selectedIds?: string[];      // if provided, schedules just these; else schedules all pending
  onDone?: () => void;
  disabled?: boolean;
  pendingCount: number;
}

export function ScheduleDialog({
  triggerLabel, triggerClass, selectedIds, onDone, disabled, pendingCount,
}: Props) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate());
  const [time, setTime] = useState("10:30");
  const [isPending, startTransition] = useTransition();

  function handleSchedule() {
    if (pendingCount === 0) { toast.error("No pending drafts to schedule."); return; }
    const iso = istToUtcIso(date, time);
    const targetMs = new Date(iso).getTime();
    if (isNaN(targetMs)) { toast.error("Invalid date/time."); return; }
    if (targetMs <= Date.now()) {
      toast.error("Schedule time must be in the future."); return;
    }

    const label = `${date} at ${time} IST`;
    if (!confirm(`Schedule ${pendingCount} email(s) to send at ${label}?`)) return;

    startTransition(async () => {
      const opts = { scheduledAtIso: iso };
      const r = selectedIds && selectedIds.length > 0
        ? await scheduleSelectedForTomorrow(selectedIds, opts)
        : await schedulePendingForTomorrow(opts);
      if (r.ok) {
        toast.success(`✓ Scheduled ${r.scheduled} for ${r.scheduled_at_local}`);
        setOpen(false);
        onDone?.();
      } else toast.error(r.error ?? "Schedule failed.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm" disabled={disabled || pendingCount === 0}
          className={triggerClass ?? "bg-violet-500 hover:bg-violet-400 text-white border-0"}
        >
          <Moon className="h-4 w-4 mr-2" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule send</DialogTitle>
          <DialogDescription>
            All times are in <strong>IST</strong> (your local). GitHub Actions cron picks them
            up automatically — your laptop can be off.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Date (IST)</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Time (IST)</Label>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} step="900" className="mt-1" />
          </div>
        </div>

        <div className="text-xs text-slate-500 space-y-1">
          <div>
            Will dispatch <strong>{pendingCount}</strong> draft(s) at{" "}
            <strong>{date} {time} IST</strong>.
          </div>
          <div className="text-[10px] text-slate-400">
            Note: GitHub Actions cron runs every 15–30 min, so actual send may be up to that late.
            For exact-minute precision, use Send NOW.
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={isPending}>Cancel</Button>
          </DialogClose>
          <Button onClick={handleSchedule} disabled={isPending}>
            {isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scheduling…</>
              : <><Moon className="h-4 w-4 mr-2" /> Schedule {pendingCount}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
