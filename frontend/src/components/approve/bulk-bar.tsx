"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { rejectSend } from "@/app/actions/approvals";

export function BulkBar({ selected, onClear }: { selected: string[]; onClear: () => void }) {
  const [isPending, startTransition] = useTransition();

  if (selected.length === 0) return null;

  function rejectAll() {
    if (!confirm(`Reject ${selected.length} drafts? They will not be sent.`)) return;
    startTransition(async () => {
      for (const id of selected) await rejectSend(id);
      toast.success(`Rejected ${selected.length} drafts`);
      onClear();
    });
  }

  return (
    <div className="sticky top-0 z-10 -mx-8 -mt-8 mb-4 px-8 py-3 bg-slate-900 text-white flex items-center justify-between">
      <div className="text-sm">{selected.length} selected</div>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="text-white hover:bg-slate-800" onClick={onClear}>Clear</Button>
        <Button size="sm" onClick={rejectAll} disabled={isPending} className="bg-red-600 hover:bg-red-700">
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Reject selected
        </Button>
      </div>
    </div>
  );
}
