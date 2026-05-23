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

const PRESETS = [25, 50, 100, 150, 200];

export function ApprovalList({ drafts }: { drafts: Draft[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customN, setCustomN] = useState<string>("");

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    setSelected(next);
  }

  function selectFirst(n: number) {
    const take = Math.min(Math.max(0, n), drafts.length);
    setSelected(new Set(drafts.slice(0, take).map(d => d.id)));
  }

  function applyCustom() {
    const n = parseInt(customN, 10);
    if (isNaN(n) || n < 1) return;
    selectFirst(n);
  }

  const allChecked = selected.size === drafts.length && drafts.length > 0;

  return (
    <>
      <BulkBar selected={[...selected]} onClear={() => setSelected(new Set())} />
      <div className="space-y-2">
        <div className="bg-slate-50 border border-slate-200 rounded-md p-3 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox" checked={allChecked}
              onChange={(e) => setSelected(e.target.checked ? new Set(drafts.map(d => d.id)) : new Set())}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span className="font-medium text-slate-700">Select all ({drafts.length})</span>
          </label>

          <span className="text-slate-300 mx-1">|</span>
          <span className="text-slate-500 font-medium">Quick select:</span>
          {PRESETS.map(n => (
            <button
              key={n} type="button" onClick={() => selectFirst(n)}
              disabled={drafts.length === 0}
              className="rounded border border-slate-300 bg-white hover:bg-slate-100 px-2 py-1 font-medium text-slate-700 disabled:opacity-40"
            >
              First {n}
            </button>
          ))}

          <span className="text-slate-300 mx-1">|</span>
          <input
            type="number" min={1} max={drafts.length}
            value={customN} onChange={(e) => setCustomN(e.target.value)}
            placeholder="e.g. 73"
            className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
          />
          <button
            type="button" onClick={applyCustom}
            disabled={!customN || drafts.length === 0}
            className="rounded bg-slate-900 hover:bg-slate-800 px-2 py-1 text-white font-medium disabled:opacity-40"
          >
            Select first N
          </button>

          {selected.size > 0 && (
            <>
              <span className="text-slate-300 mx-1">|</span>
              <span className="text-slate-700 font-semibold">
                {selected.size} selected
              </span>
              <button
                type="button" onClick={() => setSelected(new Set())}
                className="text-slate-500 hover:text-slate-900 underline"
              >
                Clear
              </button>
            </>
          )}
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
