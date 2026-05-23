"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cancelScheduledSends } from "@/app/actions/send";
import { ScheduledRow } from "./scheduled-row";

interface Row {
  id: string;
  contact_name: string;
  contact_email: string;
  company_name: string;
  rendered_subject: string;
  scheduled_at: string;
}

export function ScheduledList({ rows }: { rows: Row[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    setSelected(next);
  }

  function cancelSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Cancel ${selected.size} scheduled send(s)?\n\nThey'll move back to the Approve queue as pending drafts.`)) return;
    startTransition(async () => {
      const r = await cancelScheduledSends([...selected]);
      if (r.ok) {
        toast.success(`✓ Cancelled ${r.cancelled} — back in Approve queue`);
        setSelected(new Set());
      } else toast.error(r.error ?? "Failed.");
    });
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 -mx-8 -mt-8 mb-4 px-8 py-3 bg-slate-900 text-white flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-medium">{selected.size} selected</div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-white hover:bg-slate-800"
              onClick={() => setSelected(new Set())} disabled={isPending}>
              Clear
            </Button>
            <Button size="sm" onClick={cancelSelected} disabled={isPending} className="bg-red-600 hover:bg-red-700">
              {isPending
                ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Cancelling…</>
                : <><XCircle className="h-3.5 w-3.5 mr-1" /> Cancel selected ({selected.size})</>}
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
        <input
          type="checkbox"
          checked={selected.size === rows.length && rows.length > 0}
          onChange={(e) => setSelected(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())}
          className="h-4 w-4 rounded border-slate-300"
        />
        <span>Select all ({rows.length})</span>
      </div>

      <div className="divide-y divide-slate-100">
        {rows.map(r => (
          <ScheduledRow key={r.id} row={r}
            checked={selected.has(r.id)}
            onCheck={(v) => toggle(r.id, v)} />
        ))}
      </div>
    </>
  );
}
