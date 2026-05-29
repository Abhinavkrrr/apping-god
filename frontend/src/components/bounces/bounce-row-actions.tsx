"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { RotateCcw, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { restoreContact, deleteBounceRecord } from "@/app/actions/bounces";

export function BounceRowActions({
  bounceId,
  contactId,
  contactName,
  isBlocked,
}: {
  bounceId: string;
  contactId: string | null;
  contactName: string;
  isBlocked: boolean;
}) {
  const [busy, setBusy] = useState<"restore" | "delete" | null>(null);
  const [, startTransition] = useTransition();

  function handleRestore() {
    if (!contactId) return;
    if (!confirm(`Restore ${contactName}?\n\nThis removes the bounce block on their contact record so the agent will try sending again. Only do this if you're confident the address is valid (e.g. soft-bounce caused by a temporary outage).`)) return;
    setBusy("restore");
    startTransition(async () => {
      const r = await restoreContact(contactId);
      setBusy(null);
      if (r.ok) toast.success(`✓ Restored ${contactName} — they're sendable again.`);
      else toast.error(r.error ?? "Restore failed.");
    });
  }

  function handleDelete() {
    if (!confirm(`Delete this bounce record?\n\nThe contact's block status is unaffected — this just removes the audit log entry.`)) return;
    setBusy("delete");
    startTransition(async () => {
      const r = await deleteBounceRecord(bounceId);
      setBusy(null);
      if (r.ok) toast.success("✓ Bounce record deleted.");
      else toast.error(r.error ?? "Delete failed.");
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {isBlocked && contactId && (
        <Button
          size="sm" variant="outline"
          onClick={handleRestore} disabled={busy !== null}
          className="h-7 px-2 text-xs"
          title={`Un-block ${contactName} so the agent will try sending again`}
        >
          {busy === "restore"
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <><RotateCcw className="h-3 w-3 mr-1" /> Restore</>}
        </Button>
      )}
      <Button
        size="sm" variant="ghost"
        onClick={handleDelete} disabled={busy !== null}
        className="h-7 px-2 text-xs text-slate-500 hover:text-red-600"
        title="Delete this bounce record (audit log only — does not affect contact)"
      >
        {busy === "delete"
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : <Trash2 className="h-3 w-3" />}
      </Button>
    </div>
  );
}
