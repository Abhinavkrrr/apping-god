"use client";

import { useState, useTransition } from "react";
import { Paperclip, PaperclipIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setCampaignResume, type ResumeOption } from "@/app/actions/resumes";

export function ResumeToggle({
  campaignId,
  campaignName,
  currentResumeId,
  options,
}: {
  campaignId: string;
  campaignName: string;
  currentResumeId: string | null;
  options: ResumeOption[];
}) {
  const [resumeId, setResumeId] = useState<string | null>(currentResumeId);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  function handleChange(newValue: string) {
    const newResumeId = newValue === "__none__" ? null : newValue;
    // Optimistic UI flip
    const previous = resumeId;
    setResumeId(newResumeId);
    setBusy(true);

    startTransition(async () => {
      const r = await setCampaignResume(campaignId, newResumeId);
      setBusy(false);
      if (!r.ok) {
        toast.error(r.error ?? "Update failed.");
        setResumeId(previous); // revert on error
        return;
      }
      const verb = newResumeId ? "Attached" : "Detached";
      const what = newResumeId ? `'${r.resume_label}'` : "CV";
      const drafts = r.drafts_updated && r.drafts_updated > 0
        ? ` + ${r.drafts_updated} pending draft${r.drafts_updated === 1 ? "" : "s"}`
        : "";
      toast.success(`${verb} ${what} to ${campaignName}${drafts}`, { duration: 5000 });
    });
  }

  const attached = resumeId !== null;
  const currentLabel = options.find(o => o.id === resumeId)?.label ?? "—";

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${
        attached
          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
          : "bg-slate-100 border-slate-200 text-slate-500"
      }`}>
        {busy
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : attached
            ? <Paperclip className="h-3.5 w-3.5" />
            : <PaperclipIcon className="h-3.5 w-3.5 opacity-50" />}
        <span className="font-medium">
          {attached ? "CV attached" : "No CV"}
        </span>
      </div>

      <select
        value={resumeId ?? "__none__"}
        onChange={(e) => handleChange(e.target.value)}
        disabled={busy}
        className="text-xs rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50 disabled:opacity-50 max-w-[260px] truncate"
        title={attached ? `Attaching: ${currentLabel}` : "No CV attached to first-touch sends"}
      >
        <option value="__none__">— No CV attachment —</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>
            {o.label}{o.is_default ? " (default)" : ""}
          </option>
        ))}
      </select>

      <span className="text-[10px] text-slate-400 ml-1 hidden sm:inline">
        (first-touch only — follow-ups never attach CV)
      </span>
    </div>
  );
}
