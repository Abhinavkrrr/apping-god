"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Layers } from "lucide-react";
import { toast } from "sonner";
import { ApprovalRow } from "./approval-row";
import { BulkBar } from "./bulk-bar";
import { consolidatePendingDrafts } from "@/app/actions/send";

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

  // Per-batch UNIQUE CONTACT counts (NOT raw draft rows).
  // With N active campaigns, each contact has up to N pending drafts, so
  // raw draft counts inflate the chip badges to ~N× the file size. Users
  // imported 274 contacts in fintech.csv → expect the chip to say 274,
  // not 751 (= 274 × ~3 campaigns). Count unique contact emails per
  // batch instead.
  //
  // Side-table draftCountsByBatch is also kept so the header can still
  // show the total visible-draft count (those are what get selected /
  // sent / scheduled, so the user needs to see them too).
  const { contactCountsByBatch, draftCountsByBatch } = useMemo(() => {
    const emails = new Map<string, Set<string>>();
    const drafts_n = new Map<string, number>();
    for (const d of drafts) {
      const k = d.import_batch_id ?? "__none__";
      if (!emails.has(k)) emails.set(k, new Set());
      emails.get(k)!.add(d.contact_email);
      drafts_n.set(k, (drafts_n.get(k) ?? 0) + 1);
    }
    const contacts_n = new Map<string, number>();
    for (const [k, set] of emails) contacts_n.set(k, set.size);
    return { contactCountsByBatch: contacts_n, draftCountsByBatch: drafts_n };
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
  // Orphan chip is shown when there are contacts with no batch_id assigned.
  // Use contact count (not draft count) for the visibility decision so the
  // chip appears once even if those contacts have 3 drafts each.
  const orphanCount = contactCountsByBatch.get("__none__") ?? 0;
  const orphanDraftCount = draftCountsByBatch.get("__none__") ?? 0;

  // ── Consolidate state ──────────────────────────────────────────
  // Total drafts minus unique contacts = duplicate count. If > 0, show
  // the "Consolidate" button so user can collapse to 1 per contact.
  const totalDrafts = drafts.length;
  const uniqueContactCount = useMemo(
    () => new Set(drafts.map(d => d.contact_email)).size,
    [drafts]
  );
  const duplicateCount = Math.max(0, totalDrafts - uniqueContactCount);
  const [consolidating, setConsolidating] = useState(false);
  const [, startTrans] = useTransition();

  function handleConsolidate() {
    if (!confirm(
      `Collapse ${totalDrafts} pending drafts down to ${uniqueContactCount} (1 per contact)?\n\n` +
      `For every contact with multiple pending drafts (in different campaigns), the MOST RECENT one is kept and the others are deleted.\n\n` +
      `This will delete ${duplicateCount} duplicate draft${duplicateCount === 1 ? "" : "s"}. Cannot be undone.`
    )) return;
    setConsolidating(true);
    startTrans(async () => {
      const r = await consolidatePendingDrafts();
      setConsolidating(false);
      if (r.ok) {
        toast.success(
          `✓ Consolidated · deleted ${r.deleted} duplicate${r.deleted === 1 ? "" : "s"} · ${r.after?.total_drafts ?? "?"} drafts remaining (${r.after?.contacts ?? "?"} contacts)`,
          { duration: 8000 }
        );
        // Page revalidates server-side; the next render will show fresh numbers
      } else {
        toast.error(r.error ?? "Consolidate failed.");
      }
    });
  }

  // ALWAYS show the chip row whenever batches exist — including batches
  // with zero pending drafts (so the user sees every CSV they've imported
  // and can understand the structure of their pipeline).
  const showBatchFilter = batches.length > 0;
  const chipCount = batches.length + (orphanCount > 0 ? 1 : 0);
  const allBatchesOn = activeBatches.size === chipCount;
  const checkedBatchesCount = batches.filter(b => activeBatches.has(b.id)).length
    + (orphanCount > 0 && activeBatches.has("__none__") ? 1 : 0);

  return (
    <>
      <BulkBar selected={[...selected]} onClear={() => setSelected(new Set())} />
      <div className="space-y-2">
        {showBatchFilter && (
          <div className="bg-violet-50 border border-violet-200 rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-[11px] uppercase tracking-wide text-violet-700 font-semibold">
                Import batches — uncheck to hide drafts from that file
                <span className="ml-2 normal-case font-normal text-violet-600">
                  ({checkedBatchesCount}/{chipCount} on · chip counts show <strong>contacts</strong> · {visibleDrafts.length} of {drafts.length} drafts visible)
                </span>
              </div>
              <div className="flex gap-2 text-[10px] font-medium items-center">
                {duplicateCount > 0 && (
                  <button
                    type="button"
                    onClick={handleConsolidate}
                    disabled={consolidating}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200 disabled:opacity-50"
                    title={`You have ${totalDrafts} pending drafts but only ${uniqueContactCount} unique contacts (${duplicateCount} contacts have drafts in multiple campaigns). Click to keep 1 draft per contact (most recent) and delete the rest.`}
                  >
                    {consolidating
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Layers className="h-3 w-3" />}
                    Consolidate {duplicateCount} duplicate{duplicateCount === 1 ? "" : "s"}
                  </button>
                )}
                {!allBatchesOn && (
                  <button
                    type="button" onClick={selectAllBatches}
                    className="text-violet-700 underline hover:text-violet-900"
                  >
                    Check all
                  </button>
                )}
                {allBatchesOn && batches.length > 1 && (
                  <button
                    type="button"
                    onClick={() => { setActiveBatches(new Set()); setSelected(new Set()); }}
                    className="text-violet-700 underline hover:text-violet-900"
                  >
                    Uncheck all
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {batches.map(b => {
                const contactsInBatch = contactCountsByBatch.get(b.id) ?? 0;
                const draftsInBatch   = draftCountsByBatch.get(b.id)   ?? 0;
                const on = activeBatches.has(b.id);
                const empty = contactsInBatch === 0;
                return (
                  <label
                    key={b.id}
                    className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                      on
                        ? empty
                          ? "bg-violet-100 text-violet-700 border-violet-300"
                          : "bg-violet-600 text-white border-violet-600"
                        : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                    }`}
                    title={`${b.source} · ${contactsInBatch} unique contact${contactsInBatch === 1 ? "" : "s"} with pending drafts · ${draftsInBatch} pending draft${draftsInBatch === 1 ? "" : "s"} total (one per active campaign) · ${b.contact_count} total contacts in this batch · imported ${new Date(b.created_at).toLocaleString()}${
                      empty ? "\n(no pending drafts — all have been sent or none generated yet)" : ""
                    }`}
                    onDoubleClick={() => selectOnlyBatch(b.id)}
                  >
                    <input
                      type="checkbox" checked={on}
                      onChange={() => toggleBatch(b.id)}
                      className={`h-3 w-3 rounded ${on && !empty ? "accent-white" : ""}`}
                    />
                    <span>{b.name}</span>
                    <span className={`text-[10px] ${
                      on ? (empty ? "text-violet-500" : "text-violet-100") : "text-slate-400"
                    }`}>
                      ({contactsInBatch})
                    </span>
                  </label>
                );
              })}
              {orphanCount > 0 && (
                <label
                  className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                    activeBatches.has("__none__")
                      ? "bg-slate-700 text-white border-slate-700"
                      : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                  }`}
                  title={`Contacts without an import_batch_id · ${orphanCount} unique contact${orphanCount === 1 ? "" : "s"} · ${orphanDraftCount} pending draft${orphanDraftCount === 1 ? "" : "s"}`}
                  onDoubleClick={() => selectOnlyBatch("__none__")}
                >
                  <input
                    type="checkbox" checked={activeBatches.has("__none__")}
                    onChange={() => toggleBatch("__none__")}
                    className="h-3 w-3 rounded"
                  />
                  <span>Untagged</span>
                  <span className={`text-[10px] ${activeBatches.has("__none__") ? "text-slate-200" : "text-slate-400"}`}>
                    ({orphanCount})
                  </span>
                </label>
              )}
            </div>
            <div className="text-[10px] text-violet-700/70 leading-relaxed">
              Tip: double-click any chip to <strong>isolate</strong> (hide every other batch in one click).
              Empty chips = no pending drafts in that batch right now.
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

          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded border border-slate-300 bg-white hover:bg-red-50 hover:border-red-300 hover:text-red-700 px-2 py-1 font-medium text-slate-700"
              title="Clear all row selections (does not affect batch chip filters above)"
            >
              Uncheck all
            </button>
          )}

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
