"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { bulkApprove } from "@/app/actions/approvals";

export function BulkBar({ selected, onClear }: { selected: string[]; onClear: () => void }) {
  const [isPending, startTransition] = useTransition();

  if (selected.length === 0) return null;

  function approve() {
    startTransition(async () => {
      const r = await bulkApprove(selected);
      if (r.ok) {
        toast.success(`Approved ${r.count} drafts`);
        onClear();
      } else toast.error("Bulk approve failed");
    });
  }

  return (
    <div className="sticky top-0 z-10 -mx-8 -mt-8 mb-4 px-8 py-3 bg-slate-900 text-white flex items-center justify-between">
      <div className="text-sm">{selected.length} selected</div>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="text-white hover:bg-slate-800" onClick={onClear}>Clear</Button>
        <Button size="sm" onClick={approve} disabled={isPending} className="bg-white text-slate-900 hover:bg-slate-100">
          <Check className="h-3.5 w-3.5 mr-1" /> Approve all selected
        </Button>
      </div>
    </div>
  );
}
