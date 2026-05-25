"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { deleteBatch, previewBatchDelete } from "@/app/actions/contacts";
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
}: {
  batches: BatchInfo[];
  activeId: string;       // "__all__" | "__none__" | batch UUID
  totalContacts: number;
  noBatchCount: number;
}) {
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<BatchInfo | null>(null);
  const [preview, setPreview] = useState<{
    contacts?: number; pending_drafts?: number; scheduled?: number; sent?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();

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
