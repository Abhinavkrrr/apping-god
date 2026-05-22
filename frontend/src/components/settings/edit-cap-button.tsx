"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { Settings2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { updateAccount } from "@/app/actions/accounts";

export function EditCapButton({ accountId, currentCap, email }: {
  accountId: string; currentCap: number; email: string;
}) {
  const [open, setOpen] = useState(false);
  const [cap, setCap] = useState(currentCap);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    if (cap < 1 || cap > 500) { toast.error("Cap must be between 1 and 500."); return; }
    startTransition(async () => {
      const r = await updateAccount(accountId, { daily_cap: cap });
      if (r.ok) {
        toast.success(`Cap for ${email} set to ${cap}/day`);
        setOpen(false);
      } else toast.error("Failed.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" title="Edit daily cap">
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit daily send cap</DialogTitle>
          <DialogDescription>
            How many emails can <strong>{email}</strong> send per day before the send-worker rotates to another account?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Daily cap</Label>
            <Input type="number" min={1} max={500} value={cap}
              onChange={(e) => setCap(parseInt(e.target.value || "35"))}
              className="mt-1" />
          </div>

          <div className={`rounded-md border p-3 text-xs space-y-1 ${
            cap <= 35 ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : cap <= 80 ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-red-200 bg-red-50 text-red-800"
          }`}>
            <div className="flex items-center gap-1 font-medium">
              {cap > 35 && <AlertTriangle className="h-3.5 w-3.5" />}
              {cap <= 35 ? "Safe zone" : cap <= 80 ? "Caution zone" : "Danger zone"}
            </div>
            <div>
              {cap <= 35 && "Personal Gmail handles 30–50/day cold-email volume comfortably."}
              {cap > 35 && cap <= 80 && "Above 50/day, Gmail starts paying attention to new-recipient ratio. OK if you have replies coming back."}
              {cap > 80 && cap <= 200 && "Account may be flagged within 1–2 weeks. Use Workspace + custom domain for safer scaling."}
              {cap > 200 && "Account likely suspended within days. Use multi-account rotation (add more accounts) instead of high cap."}
            </div>
            <div className="text-[10px] opacity-75 mt-1">
              Gmail&apos;s technical SMTP limit is 500/day. The dangerous numbers above are about spam flagging, not SMTP rejection.
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={handleSave} disabled={isPending || cap === currentCap}>
            {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
