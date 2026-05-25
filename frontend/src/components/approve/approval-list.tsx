"use client";

import { useMemo, useState } from "react";
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
  import_batch_id: string | null;
}

export interface BatchInfo {
  id: string;
  name: string;
  source: string;
  contact_count: number;
  created_at: string;
}

const PRESETS = [25, 50, 100, 150, 200];

export function ApprovalList({
  drafts,
  batches = [],
}: {
  drafts: Draft[];
  batches?: BatchInfo[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customN, setCustomN] = useState<string>("");
  // All batches selected by default. Sentinel "__none__" represents
  // pre-batch contacts with no import_batch_id.
  const [activeBatches, setActiveBatches] = useState<Set<string>>(
    () => new Set([...batches.map(b => b.id), "__none__"])
  );

  // Per-batch draft counts within the current pending pool (not the global
  // contact_count — that includes already-sent contacts too).
  const draftCountsByBatch = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of drafts) {
      const k = d.import_batch_id ?? "__none__";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [drafts]);

  const visibleDrafts = useMemo(
    () => drafts.filter(d => activeBatches.has(d.import_batch_id ?? "__none__")),
    [drafts, activeBatches]
  );

  function toggleBatch(id: string) {
    const next = new Set(activeBatches);
    if (next.has(id)) next.delete(id); else next.add(id);
    setActiveBatches(next);
    // Clear selection on batch change to avoid sending to hidden rows
    setSelected(new Set());
  }
  function selectAllBatches() {
    setActiveBatches(new Set([...batches.map(b => b.id), "__none__"]));
    setSelected(new Set());
  }
  function selectOnlyBatch(id: string) {
    setActiveBatches(new Set([id]));
    setSelected(new Set());
  }

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    setSelected(next);
  }

  function selectFirst(n: number) {
    const take = Math.min(Math.max(0, n), visibleDrafts.length);
    setSelected(new Set(visibleDrafts.slice(0, take).map(d => d.id)));
  }

  function applyCustom() {
    const n = parseInt(customN, 10);
    if (isNaN(n) || n < 1) return;
    selectFirst(n);
  }

  const allChecked = selected.size === visibleDrafts.length && visibleDrafts.length > 0;
  const orphanCount = draftCountsByBatch.get("__none__") ?? 0;

  // Show batch filter when there's more than one batch (otherwise it's noise)
  const showBatchFilter = batches.length + (orphanCount > 0 ? 1 : 0) > 1;
  const allBatchesOn = activeBatches.size === batches.length + (orphanCount > 0 ? 1 : 0);

  return (
    <>
      <BulkBar selected={[...selected]} onClear={() => setSelected(new Set())} />
      <div className="space-y-2">
        {showBatchFilter && (
          <div className="bg-violet-50 border border-violet-200 rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-violet-700 font-semibold">
              <span>Import batch filter — click to toggle, double-click to isolate</span>
              {!allBatchesOn && (
                <button
                  type="button" onClick={selectAllBatches}
                  className="text-[10px] normal-case font-medium text-violet-700 underline hover:text-violet-900"
                >
                  Show all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {batches.map(b => {
                const n = draftCountsByBatch.get(b.id) ?? 0;
                const on = activeBatches.has(b.id);
                if (n === 0 && allBatchesOn) return null; // hide batches with no pending drafts when nothing's been narrowed
                return (
                  <button
                    key={b.id} type="button"
                    onClick={() => toggleBatch(b.id)}
                    onDoubleClick={() => selectOnlyBatch(b.id)}
                    className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
                      on
                        ? "bg-violet-600 text-white border-violet-600"
                        : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                    }`}
                    title={`${b.source} · ${b.contact_count} total contacts · ${new Date(b.created_at).toLocaleDateString()}`}
                  >
                    {b.name}
                    <span className={`ml-1.5 text-[10px] ${on ? "text-violet-100" : "text-slate-400"}`}>
                      {n}
                    </span>
                  </button>
                );
              })}
              {orphanCount > 0 && (
                <button
                  type="button"
                  onClick={() => toggleBatch("__none__")}
                  onDoubleClick={() => selectOnlyBatch("__none__")}
                  className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
                    activeBatches.has("__none__")
                      ? "bg-slate-700 text-white border-slate-700"
                      : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                  }`}
                  title="Contacts without an import_batch_id"
                >
                  Untagged
                  <span className={`ml-1.5 text-[10px] ${activeBatches.has("__none__") ? "text-slate-200" : "text-slate-400"}`}>
                    {orphanCount}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        <div className="bg-slate-50 border border-slate-200 rounded-md p-3 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox" checked={allChecked}
              onChange={(e) => setSelected(e.target.checked ? new Set(visibleDrafts.map(d => d.id)) : new Set())}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span className="font-medium text-slate-700">
              Select all ({visibleDrafts.length}
              {visibleDrafts.length !== drafts.length && ` of ${drafts.length}`})
            </span>
          </label>

          <span className="text-slate-300 mx-1">|</span>
          <span className="text-slate-500 font-medium">Quick select:</span>
          {PRESETS.map(n => (
            <button
              key={n} type="button" onClick={() => selectFirst(n)}
              disabled={visibleDrafts.length === 0}
              className="rounded border border-slate-300 bg-white hover:bg-slate-100 px-2 py-1 font-medium text-slate-700 disabled:opacity-40"
            >
              First {n}
            </button>
          ))}

          <span className="text-slate-300 mx-1">|</span>
          <input
            type="number" min={1} max={visibleDrafts.length}
            value={customN} onChange={(e) => setCustomN(e.target.value)}
            placeholder="e.g. 73"
            className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
          />
          <button
            type="button" onClick={applyCustom}
            disabled={!customN || visibleDrafts.length === 0}
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

        {visibleDrafts.map(d => (
          <ApprovalRow
            key={d.id} draft={d}
            checked={selected.has(d.id)}
            onCheck={(v) => toggle(d.id, v)}
          />
        ))}
        {visibleDrafts.length === 0 && (
          <div className="text-center py-12 text-sm text-slate-500 bg-white border border-slate-200 rounded-md">
            No drafts match the current batch filter. Toggle a batch chip above to include more.
          </div>
        )}
      </div>
    </>
  );
}
