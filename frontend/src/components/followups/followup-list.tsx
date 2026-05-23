"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendFollowupsBatch } from "@/app/actions/followups";
import { FollowupRow } from "./followup-row";

interface Thread {
  last_send_id: string;
  contact_id: string;
  contact_name: string;
  contact_email: string;
  company_name: string;
  sent_at: string;
  days_since: number;
  highest_step: number;
  has_reply: boolean;
}

const PRESETS = [25, 50, 100, 150, 200];

export function FollowupList({ threads }: { threads: Thread[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customN, setCustomN] = useState("");
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Only threads that are eligible for a next follow-up
  const eligibleThreads = threads.filter(t => t.highest_step < 3 && !t.has_reply);

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    setSelected(next);
  }

  function selectFirstN(n: number) {
    const take = Math.min(Math.max(0, n), eligibleThreads.length);
    setSelected(new Set(eligibleThreads.slice(0, take).map(t => t.last_send_id)));
  }

  function applyCustom() {
    const n = parseInt(customN, 10);
    if (isNaN(n) || n < 1) return;
    selectFirstN(n);
  }

  function sendSelected() {
    if (selected.size === 0) { toast.error("Nothing selected."); return; }
    const estimatedMin = Math.ceil(selected.size * 7 / 60);
    if (!confirm(`Send follow-up to ${selected.size} thread(s)?\n\nEstimated time: ~${estimatedMin} min (each takes ~7s).\nThreads under the original Gmail conversation.`)) return;
    setBusy(true);
    startTransition(async () => {
      toast.info(`Dispatching ${selected.size} follow-ups…`);
      const r = await sendFollowupsBatch([...selected]);
      setBusy(false);
      if (r.ok) {
        toast.success(`✓ Sent: ${r.sent} · Skipped: ${r.skipped} · Failed: ${r.failed}`);
        setSelected(new Set());
      } else {
        toast.error(r.error ?? "Failed.");
      }
    });
  }

  const allEligibleChecked = selected.size === eligibleThreads.length && eligibleThreads.length > 0;

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 -mx-8 -mt-8 mb-4 px-8 py-3 bg-slate-900 text-white flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-medium">{selected.size} selected</div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-white hover:bg-slate-800"
              onClick={() => setSelected(new Set())} disabled={busy}>
              Clear
            </Button>
            <Button size="sm" onClick={sendSelected} disabled={busy} className="bg-emerald-500 hover:bg-emerald-400">
              {busy
                ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Sending…</>
                : <><Send className="h-3.5 w-3.5 mr-1" /> Send follow-ups to selected ({selected.size})</>}
            </Button>
          </div>
        </div>
      )}

      <div className="bg-slate-50 border border-slate-200 rounded-md p-3 flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox" checked={allEligibleChecked}
            onChange={(e) => setSelected(e.target.checked ? new Set(eligibleThreads.map(t => t.last_send_id)) : new Set())}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="font-medium text-slate-700">
            Select all eligible ({eligibleThreads.length})
          </span>
        </label>

        <span className="text-slate-300 mx-1">|</span>
        <span className="text-slate-500 font-medium">Quick select:</span>
        {PRESETS.map(n => (
          <button
            key={n} type="button" onClick={() => selectFirstN(n)}
            disabled={eligibleThreads.length === 0 || isPending}
            className="rounded border border-slate-300 bg-white hover:bg-slate-100 px-2 py-1 font-medium text-slate-700 disabled:opacity-40"
          >
            First {n}
          </button>
        ))}

        <span className="text-slate-300 mx-1">|</span>
        <input
          type="number" min={1} max={eligibleThreads.length}
          value={customN} onChange={(e) => setCustomN(e.target.value)}
          placeholder="e.g. 73"
          className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
        />
        <button
          type="button" onClick={applyCustom}
          disabled={!customN || eligibleThreads.length === 0}
          className="rounded bg-slate-900 hover:bg-slate-800 px-2 py-1 text-white font-medium disabled:opacity-40"
        >
          Select first N
        </button>

        {(threads.length - eligibleThreads.length) > 0 && (
          <span className="text-slate-400 ml-auto text-[10px]">
            {threads.length - eligibleThreads.length} thread(s) not selectable (replied / all done)
          </span>
        )}
      </div>

      <div className="divide-y divide-slate-100 mt-2">
        {threads.map(t => (
          <FollowupRow
            key={t.contact_id} thread={t}
            checked={selected.has(t.last_send_id)}
            onCheck={(v) => toggle(t.last_send_id, v)}
            selectable={t.highest_step < 3 && !t.has_reply}
          />
        ))}
      </div>
    </>
  );
}
