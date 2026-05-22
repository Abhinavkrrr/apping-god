"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Send, Moon, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  generateDrafts, sendAllPendingNow, schedulePendingForTomorrow,
} from "@/app/actions/send";

interface CampaignOpt { name: string; eligible: number; }

export function DispatchBar({
  pendingCount,
  campaignOptions,
}: {
  pendingCount: number;
  campaignOptions: CampaignOpt[];
}) {
  const [busy, setBusy] = useState<"generate" | "send" | "schedule" | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedCampaign, setSelectedCampaign] = useState<string>("__all__");
  const [useLlm, setUseLlm] = useState<boolean>(false);

  const totalEligible = selectedCampaign === "__all__"
    ? campaignOptions.reduce((s, c) => s + c.eligible, 0)
    : (campaignOptions.find(c => c.name === selectedCampaign)?.eligible ?? 0);

  function handleGenerate() {
    if (totalEligible === 0) { toast.error("No eligible contacts (all already drafted or no active campaign)."); return; }
    const llmWarning = useLlm
      ? `\n\nGemini personalization will take ~2 seconds per contact (≈${Math.ceil(totalEligible * 2 / 60)} min).`
      : "";
    if (!confirm(`Generate ${totalEligible} draft(s) ${useLlm ? "with Gemini personalization" : "(fast, no LLM)"}?${llmWarning}`)) return;

    setBusy("generate");
    startTransition(async () => {
      toast.info(useLlm
        ? `Generating ${totalEligible} drafts with Gemini... could take ${Math.ceil(totalEligible * 2 / 60)} min.`
        : `Generating ${totalEligible} drafts (fast mode)...`);
      const r = await generateDrafts({
        campaign: selectedCampaign === "__all__" ? undefined : selectedCampaign,
        useLlm,
      });
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
    if (!confirm(`Send ${pendingCount} email(s) RIGHT NOW?\n\nThis dispatches via the Edge Function with 5-15s jitter between sends to avoid Gmail throttling.\n\nThis cannot be undone.`)) return;
    setBusy("send");
    startTransition(async () => {
      toast.info(`Dispatching ${pendingCount} emails — this will take a while...`);
      const r = await sendAllPendingNow({ limit: pendingCount });
      setBusy(null);
      if (r.ok) {
        toast.success(`✓ Sent: ${r.sent} · Failed: ${r.failed} · Skipped: ${r.skipped}`);
      } else {
        toast.error(r.error ?? "Send failed.");
      }
    });
  }

  function handleSchedule() {
    if (pendingCount === 0) { toast.error("No pending drafts to schedule."); return; }
    if (!confirm(`Schedule ${pendingCount} email(s) to send tomorrow at 10:30 AM IST?\n\nThe GitHub Actions cron will dispatch them autonomously while you sleep.`)) return;
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
    <div className="bg-slate-900 text-white rounded-lg p-4 -mx-1 mb-4 space-y-3">
      {/* Top: title + counts */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">Outreach controls</div>
          <div className="text-slate-300 text-xs mt-0.5">
            {pendingCount === 0
              ? "No pending drafts. Pick a campaign below and generate."
              : `${pendingCount} draft(s) pending review. Send, schedule, or generate more.`}
          </div>
        </div>
      </div>

      {/* Generate row */}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-700">
        <span className="text-xs uppercase tracking-wide text-slate-400 mr-1">Generate</span>
        <select
          value={selectedCampaign}
          onChange={(e) => setSelectedCampaign(e.target.value)}
          disabled={disabled}
          className="rounded bg-slate-800 border border-slate-700 px-2 py-1.5 text-xs text-white"
        >
          <option value="__all__">All active campaigns ({campaignOptions.reduce((s, c) => s + c.eligible, 0)} eligible)</option>
          {campaignOptions.map(c => (
            <option key={c.name} value={c.name}>{c.name} ({c.eligible} eligible)</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox" checked={useLlm}
            onChange={(e) => setUseLlm(e.target.checked)}
            disabled={disabled}
            className="h-3.5 w-3.5"
          />
          Personalize with Gemini (slower)
        </label>
        <Button
          variant="outline" size="sm" onClick={handleGenerate} disabled={disabled || totalEligible === 0}
          className="bg-white text-slate-900 hover:bg-slate-100 border-white ml-auto"
        >
          {busy === "generate"
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
            : <>{useLlm ? <Sparkles className="h-4 w-4 mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                Generate {totalEligible} draft{totalEligible === 1 ? "" : "s"}
              </>}
        </Button>
      </div>

      {/* Send + Schedule row */}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-700">
        <span className="text-xs uppercase tracking-wide text-slate-400 mr-1">Dispatch</span>
        <span className="text-xs text-slate-300">{pendingCount} pending</span>

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
            : <><Moon className="h-4 w-4 mr-2" /> Schedule for tomorrow 10:30 AM</>}
        </Button>
      </div>
    </div>
  );
}
