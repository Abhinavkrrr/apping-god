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
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createTemplate } from "@/app/actions/templates";

interface Campaign { id: string; name: string; }

export function NewTemplateModal({ campaigns }: { campaigns: Campaign[] }) {
  const [open, setOpen] = useState(false);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [kind, setKind] = useState<"first" | "followup">("first");
  const [step, setStep] = useState(1);
  const [variant, setVariant] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    if (!campaignId) { toast.error("Pick a campaign."); return; }
    if (!variant.trim()) { toast.error("Give the template a label (e.g. 'A', 'short-version')."); return; }
    if (!subject.trim() || !body.trim()) { toast.error("Subject and body required."); return; }

    const input = {
      campaign_id: campaignId,
      variant_label: variant.trim(),
      subject_tmpl: subject,
      body_tmpl: body,
      is_followup: kind === "followup",
      followup_step: kind === "followup" ? step : null,
    };

    startTransition(async () => {
      const r = await createTemplate(input);
      if (r.ok) {
        toast.success(`✓ Template "${variant}" created`);
        setOpen(false);
        setVariant(""); setSubject(""); setBody("");
      } else {
        toast.error(r.error ?? "Failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-2" /> New template</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create a new template</DialogTitle>
          <DialogDescription>
            Use this to add an A/B variant or extra follow-up step. The default
            first-touch template is already wired into the sequencer — new templates
            only get used if you point a sequence step at them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Campaign</Label>
              <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Variant label *</Label>
              <Input value={variant} onChange={(e) => setVariant(e.target.value)}
                placeholder="e.g. A, short-version, formal" className="mt-1" />
            </div>
            <div>
              <Label>Type</Label>
              <select value={kind} onChange={(e) => setKind(e.target.value as "first" | "followup")}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="first">First-touch</option>
                <option value="followup">Follow-up</option>
              </select>
            </div>
            {kind === "followup" && (
              <div>
                <Label>Follow-up step</Label>
                <select value={step} onChange={(e) => setStep(parseInt(e.target.value))}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value={1}>1 (Day 2)</option>
                  <option value={2}>2 (Day 4)</option>
                  <option value={3}>3 (Day 6)</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <Label>Subject *</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="Use {{company}}, {{first_name}}" className="mt-1" />
          </div>
          <div>
            <Label>Body *</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="Dear {{first_name}},&#10;&#10;{{company_brief_one_line}}&#10;..."
              rows={14} className="mt-1 text-xs" />
            <p className="text-[10px] text-slate-500 mt-1">
              <code>{`{{first_name}}`}</code>, <code>{`{{company}}`}</code>, <code>{`{{company_brief_one_line}}`}</code>, <code>{`{{title}}`}</code> get substituted per contact.
              Use <code>**bold**</code> for emphasis.
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating…</> : "Create template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
