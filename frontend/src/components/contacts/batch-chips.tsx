"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, X, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { deleteBatch, previewBatchDelete } from "@/app/actions/contacts";
import { regenerateDraftsForBatch } from "@/app/actions/send";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogClose,
} from "@/components/ui/dialog";

export interface BatchInfo {
  id: string;
  name: string;
  source: string;
  contact_count: number;
  created_at: string;
}

export function BatchChips({
  batches,
  activeId,
  totalContacts,
  noBatchCount,
  campaigns = [],
}: {
  batches: BatchInfo[];
  activeId: string;       // "__all__" | "__none__" | batch UUID
  totalContacts: number;
  noBatchCount: number;
  campaigns?: string[];   // active campaign names for the regen dropdown
}) {
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<BatchInfo | null>(null);
  const [preview, setPreview] = useState<{
    contacts?: number; pending_drafts?: number; scheduled?: number; sent?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();

  // ── Regenerate dialog state ───────────────────────────────────
  // Replaces the prompt() flow which was typo-prone (user typed
  // "Outreach" once when they meant "AI Builder Internship").
  const [pendingRegen, setPendingRegen] = useState<BatchInfo | null>(null);
  const [regenCampaign, setRegenCampaign] = useState<string>(campaigns[0] ?? "Outreach");

  async function openConfirm(b: BatchInfo) {
    setPendingDelete(b);
    setPreview(null);
    const p = await previewBatchDelete(b.id);
    if (p.ok) setPreview(p);
    else { toast.error(p.error ?? "Couldn't load preview."); setPendingDelete(null); }
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    startTransition(async () => {
      const r = await deleteBatch(pendingDelete.id);
      setBusy(false);
      if (r.ok) {
        toast.success(`✓ Deleted "${pendingDelete.name}" (${r.deleted_contacts} contacts removed)`);
        setPendingDelete(null);
        // If user was viewing the deleted batch, kick them back to "All"
        if (activeId === pendingDelete.id) router.push("/contacts?batch=__all__");
        else router.refresh();
      } else {
        toast.error(r.error ?? "Delete failed.");
      }
    });
  }

  // Don't delete the "Legacy (pre-batch)" or "Quick Add" buckets accidentally —
  // require user to type it. We just disable the trash icon for those.
  const PROTECTED = ["Legacy (pre-batch)", "Quick Add"];

  // ── Regenerate state ──────────────────────────────────────────
  const [regenerating, setRegenerating] = useState<string | null>(null);

  function openRegenerate(b: BatchInfo) {
    setPendingRegen(b);
    // Reset to first campaign every time so user makes an explicit choice
    setRegenCampaign(campaigns[0] ?? "Outreach");
  }

  function handleRegenerate() {
    if (!pendingRegen) return;
    const b = pendingRegen;
    const campaign = regenCampaign;
    if (!campaign?.trim()) return;
    setPendingRegen(null);
    setRegenerating(b.id);
    startTransition(async () => {
      const r = await regenerateDraftsForBatch(b.id, campaign.trim());
      setRegenerating(null);
      if (r.ok) {
        const parts: string[] = [];
        parts.push(`✓ Regenerated for "${b.name}"`);
        parts.push(`${r.created ?? 0} draft(s) created in ${r.campaign}`);
        if (r.deleted) parts.push(`wiped ${r.deleted} old draft(s)`);
        if (r.unblocked) parts.push(`unblocked ${r.unblocked} bounce-flagged contact(s)`);
        if ((r.created ?? 0) < (r.contacts ?? 0)) {
          parts.push(`${(r.contacts ?? 0) - (r.created ?? 0)} contact(s) still blocked (manual unsubscribe / no email)`);
        }
        toast.success(parts.join(" · "), { duration: 12000 });
        router.refresh();
      } else {
        toast.error(r.error ?? "Regenerate failed.");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/contacts?batch=__all__">
          <Badge variant={activeId === "__all__" ? "info" : "default"} className="cursor-pointer">
            All ({totalContacts})
          </Badge>
        </Link>

        {batches.map(b => (
          <div key={b.id} className="inline-flex items-center group">
            <Link href={`/contacts?batch=${encodeURIComponent(b.id)}`}>
              <Badge
                variant={activeId === b.id ? "info" : "default"}
                className="cursor-pointer rounded-r-none"
                title={`${b.source} · created ${new Date(b.created_at).toLocaleString()}`}
              >
                {b.name} ({b.contact_count})
              </Badge>
            </Link>
            <button
              type="button"
              onClick={() => openRegenerate(b)}
              disabled={regenerating !== null || b.contact_count === 0}
              className="h-[22px] px-1.5 border border-l-0 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900 transition-colors disabled:opacity-40"
              title={`Regenerate drafts for batch "${b.name}" — deletes existing pending drafts for these ${b.contact_count} contacts (any campaign) and creates fresh ones`}
            >
              {regenerating === b.id
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Sparkles className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => openConfirm(b)}
              disabled={PROTECTED.includes(b.name)}
              className={`h-[22px] px-1.5 rounded-l-none rounded-r border border-l-0 transition-colors ${
                PROTECTED.includes(b.name)
                  ? "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
                  : "border-red-200 bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700"
              }`}
              title={
                PROTECTED.includes(b.name)
                  ? `Protected — can't bulk-delete the ${b.name} bucket`
                  : `Delete batch "${b.name}" and all ${b.contact_count} contacts`
              }
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}

        {noBatchCount > 0 && (
          <Link href="/contacts?batch=__none__">
            <Badge variant={activeId === "__none__" ? "info" : "default"} className="cursor-pointer">
              Untagged ({noBatchCount})
            </Badge>
          </Link>
        )}
      </div>

      {/* Regenerate dialog — campaign picker via dropdown, no typing */}
      <Dialog open={pendingRegen !== null} onOpenChange={(o) => !o && setPendingRegen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700">
              <Sparkles className="h-5 w-5" /> Regenerate drafts for "{pendingRegen?.name}"
            </DialogTitle>
            <DialogDescription>
              For every contact in this batch ({pendingRegen?.contact_count ?? 0} contacts):
              <br />• Delete any existing pending draft (in any campaign)
              <br />• Unblock bounce-flagged contacts (only bounce-related; manual unsubscribes preserved)
              <br />• Create a fresh draft in the campaign picked below
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <label className="text-sm font-medium text-slate-700">Target campaign</label>
            <select
              value={regenCampaign}
              onChange={(e) => setRegenCampaign(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              autoFocus
            >
              {campaigns.length === 0 && <option value="Outreach">Outreach (default)</option>}
              {campaigns.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              All {pendingRegen?.contact_count ?? 0} contacts in this batch will get a fresh
              first-touch draft in <strong>{regenCampaign}</strong>. Any drafts they currently
              have in other campaigns will be deleted (switch-campaign mode).
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <DialogClose asChild>
              <Button variant="ghost" disabled={isPending}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleRegenerate}
              disabled={isPending || !regenCampaign}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Sparkles className="h-4 w-4 mr-1" />
              Regenerate {pendingRegen?.contact_count ?? 0} drafts in {regenCampaign}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Trash2 className="h-5 w-5" /> Delete batch "{pendingDelete?.name}"?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes every contact in this batch AND all their
              email history (drafts, scheduled sends, sent records, replies).
              Companies are kept.
            </DialogDescription>
          </DialogHeader>

          {preview === null ? (
            <div className="py-4 text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading impact preview…
            </div>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 space-y-2 text-sm">
              <div className="font-medium text-red-900">
                Will permanently delete:
              </div>
              <ul className="space-y-1 text-red-800">
                <li>• <strong>{preview.contacts ?? 0}</strong> contact{preview.contacts === 1 ? "" : "s"}</li>
                <li>• <strong>{preview.pending_drafts ?? 0}</strong> pending draft{preview.pending_drafts === 1 ? "" : "s"}</li>
                <li>• <strong>{preview.scheduled ?? 0}</strong> scheduled send{preview.scheduled === 1 ? "" : "s"}</li>
                <li className={`${(preview.sent ?? 0) > 0 ? "text-red-900 font-semibold" : "text-red-800"}`}>
                  • <strong>{preview.sent ?? 0}</strong> sent-email record{preview.sent === 1 ? "" : "s"}
                  {(preview.sent ?? 0) > 0 && " (you'll lose reply tracking for these)"}
                </li>
              </ul>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <DialogClose asChild>
              <Button variant="ghost" disabled={isPending}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={isPending || preview === null}
            >
              {busy
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deleting…</>
                : <><Trash2 className="h-4 w-4 mr-2" /> Yes, delete everything</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
