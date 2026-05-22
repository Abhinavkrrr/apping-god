"use client";

import { useState } from "react";
import { ApprovalRow } from "./approval-row";
import { BulkBar } from "./bulk-bar";

interface Draft {
  id: string;
  rendered_subject: string;
  rendered_body: string;
  contact_email: string;
  contact_name: string;
  company_name: string;
  campaign_name: string;
}

export function ApprovalList({ drafts }: { drafts: Draft[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    setSelected(next);
  }

  return (
    <>
      <BulkBar selected={[...selected]} onClear={() => setSelected(new Set())} />
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={selected.size === drafts.length && drafts.length > 0}
            onChange={(e) => setSelected(e.target.checked ? new Set(drafts.map(d => d.id)) : new Set())}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span>Select all ({drafts.length})</span>
        </div>
        {drafts.map(d => (
          <ApprovalRow
            key={d.id} draft={d}
            checked={selected.has(d.id)}
            onCheck={(v) => toggle(d.id, v)}
          />
        ))}
      </div>
    </>
  );
}
