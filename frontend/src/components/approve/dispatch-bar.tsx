"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Send, Moon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  generateDrafts, sendAllPendingNow, schedulePendingForTomorrow,
} from "@/app/actions/send";

export function DispatchBar({ pendingCount }: { pendingCount: number }) {
  const [busy, setBusy] = useState<"generate" | "send" | "schedule" | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    setBusy("generate");
    startTransition(async () => {
      toast.info("Generating drafts with Gemini... this can take 20-60s.");
      const r = await generateDrafts({ limit: 25, useLlm: true });
      setBusy(null);
      if (r.ok) {
        toast.success(`✓ Generated ${r.created} draft${r.created === 1 ? "" : "s"}.`);
      } else {
        toast.error(r.error ?? "Generate failed.");
      }
    });
  }

  function handleSendNow() {
    if (pendingCount === 0) { toast.error("No pending drafts."); return; }
    if (!confirm(`Send ${pendingCount} email(s) RIGHT NOW? This cannot be undone.`)) return;
    setBusy("send");
    startTransition(async () => {
      toast.info(`Dispatching ${pendingCount} emails... please wait.`);
      const r = await sendAllPendingNow({ limit: 50 });
      setBusy(null);
      if (r.ok) {
        toast.success(`✓ Sent: ${r.sent} · Failed: ${r.failed} · Skipped: ${r.skipped}`);
      } else {
        toast.error(r.error ?? "Send failed.");
      }
    });
  }

  function handleSchedule() {
    if (pendingCount === 0) { toast.error("No pending drafts."); return; }
    if (!confirm(`Schedule ${pendingCount} email(s) to send tomorrow at 10:30 AM IST?\n\nThey will dispatch autonomously via GitHub Actions cron.`)) return;
    setBusy("schedule");
    startTransition(async () => {
      const r = await schedulePendingForTomorrow({ hour: 10, minute: 30 });
      setBusy(null);
      if (r.ok) {
        toast.success(`✓ Scheduled ${r.scheduled} for ${r.scheduled_at_local}`);
      } else {
        toast.error(r.error ?? "Schedule failed.");
      }
    });
  }

  const disabled = isPending || busy !== null;

  return (
    <div className="bg-slate-900 text-white rounded-lg p-4 -mx-1 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm flex-1 min-w-fit">
          <div className="font-semibold">Outreach controls</div>
          <div className="text-slate-300 text-xs mt-0.5">
            {pendingCount === 0
              ? "No drafts pending — click Generate to build the queue."
              : `${pendingCount} draft(s) ready to send or schedule.`}
          </div>
        </div>

        <Button
          variant="outline" size="sm" onClick={handleGenerate} disabled={disabled}
          className="bg-white text-slate-900 hover:bg-slate-100 border-white"
        >
          {busy === "generate"
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
            : <><Sparkles className="h-4 w-4 mr-2" /> Generate drafts</>}
        </Button>

        <Button
          size="sm" onClick={handleSendNow} disabled={disabled || pendingCount === 0}
          className="bg-emerald-500 hover:bg-emerald-400 text-white border-0"
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
