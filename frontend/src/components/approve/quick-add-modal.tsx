"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addContactAndQueue } from "@/app/actions/quick-add";

export function QuickAddModal() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "",
    company_name: "", company_brief: "", title: "",
  });
  const [isPending, startTransition] = useTransition();

  function setField<K extends keyof typeof form>(k: K, v: string) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  function handleSave() {
    if (!form.first_name || !form.email.includes("@") || !form.company_name) {
      toast.error("First name, email, and company are required."); return;
    }
    startTransition(async () => {
      const r = await addContactAndQueue(form);
      if (r.ok) {
        toast.success(`✓ Added ${form.email} → queued in Approve`);
        setOpen(false);
        setForm({ first_name: "", last_name: "", email: "", company_name: "", company_brief: "", title: "" });
      } else toast.error(r.error ?? "Failed.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-slate-800 text-white hover:bg-slate-700 border-slate-700">
          <UserPlus className="h-4 w-4 mr-2" /> Quick add to queue
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a single contact directly to the send queue</DialogTitle>
          <DialogDescription>
            Skips Contacts page — the contact is created AND a draft is generated using the
            master template, ready in the approval queue.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>First name *</Label>
            <Input value={form.first_name} onChange={(e) => setField("first_name", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Last name</Label>
            <Input value={form.last_name} onChange={(e) => setField("last_name", e.target.value)} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>Email *</Label>
            <Input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Company *</Label>
            <Input value={form.company_name} onChange={(e) => setField("company_name", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => setField("title", e.target.value)} placeholder="Product Manager" className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>Company brief (used as {`{{company_brief_one_line}}`})</Label>
            <Textarea value={form.company_brief} onChange={(e) => setField("company_brief", e.target.value)}
              rows={2} placeholder="I've been following Company X's work in..." className="mt-1 text-xs" />
            <p className="text-[10px] text-slate-500 mt-1">
              Leave blank and Gemini will fill it from the company name later (if you enable LLM on generate).
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adding…</> : "Add + queue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
