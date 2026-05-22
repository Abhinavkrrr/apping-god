"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addAccount } from "@/app/actions/accounts";

export function AddAccountModal() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [cap, setCap] = useState(35);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    if (!email.includes("@") || !pw) { toast.error("Email + app password required."); return; }
    startTransition(async () => {
      const r = await addAccount({ email, app_password: pw, daily_cap: cap });
      if (r.ok) {
        toast.success(`Added ${email}. Warmup starts today (5 sends/day for 3 days).`);
        setOpen(false); setEmail(""); setPw(""); setCap(35);
      } else toast.error(r.error ?? "Failed.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-2" /> Add Gmail account</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a Gmail sending account</DialogTitle>
          <DialogDescription>
            Generate an App Password at{" "}
            <a className="text-blue-600 underline" target="_blank" rel="noopener noreferrer"
              href="https://myaccount.google.com/apppasswords">myaccount.google.com/apppasswords</a>.
            New accounts auto-enter 14-day warmup (5 → 35 sends/day).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Gmail address</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="abhinav.outreach2@gmail.com" className="mt-1" />
          </div>
          <div>
            <Label>App password (16 chars, no spaces)</Label>
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value.replace(/\s/g, ""))}
              placeholder="xxxxxxxxxxxxxxxx" className="mt-1 font-mono" />
          </div>
          <div>
            <Label>Daily cap (max sends/day after warmup)</Label>
            <Input type="number" min={1} max={100} value={cap}
              onChange={(e) => setCap(parseInt(e.target.value || "35"))} className="mt-1" />
            <p className="text-[10px] text-slate-500 mt-1">
              35 is safe for Gmail. Don&apos;t exceed 50.
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adding…</> : "Add account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
