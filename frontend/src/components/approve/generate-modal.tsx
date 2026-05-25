"use client";

import { useState, useTransition, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { Sparkles, Eye, Loader2, Pencil, Save } from "lucide-react";
import { toast } from "sonner";
import { renderTemplate, plainToBoldHtml, SAMPLE_CTX } from "@/lib/utils/mustache";
import { generateDrafts, saveMasterTemplate } from "@/app/actions/send";

const VARS = ["{{first_name}}", "{{company}}", "{{company_brief_one_line}}", "{{full_name}}", "{{title}}"];

export interface CampaignTemplate {
  template_id: string;
  campaign_id: string;
  campaign_name: string;
  subject_tmpl: string;
  body_tmpl: string;
  eligible_contacts: number;
  total_contacts: number;
}

interface Props {
  campaigns: CampaignTemplate[];   // active campaigns + their first-touch templates
  mode?: "edit" | "generate";
}

export function GenerateModal({ campaigns, mode = "generate" }: Props) {
  const [open, setOpen] = useState(false);
  const [campaignName, setCampaignName] = useState(campaigns[0]?.campaign_name ?? "");

  const active = useMemo(
    () => campaigns.find(c => c.campaign_name === campaignName) ?? campaigns[0] ?? null,
    [campaigns, campaignName]
  );

  const [subject, setSubject] = useState(active?.subject_tmpl ?? "");
  const [body, setBody] = useState(active?.body_tmpl ?? "");
  const [useLlm, setUseLlm] = useState(false);
  const [startFresh, setStartFresh] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [busy, setBusy] = useState<"save" | "generate" | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (next && active) {
      setSubject(active.subject_tmpl);
      setBody(active.body_tmpl);
    }
    setOpen(next);
  }

  // When campaign selection changes, swap to its template
  function pickCampaign(name: string) {
    setCampaignName(name);
    const c = campaigns.find(x => x.campaign_name === name);
    if (c) { setSubject(c.subject_tmpl); setBody(c.body_tmpl); }
  }

  if (!active) {
    return null; // no active campaign — nothing to do
  }

  const renderedSubject = renderTemplate(subject, SAMPLE_CTX);
  const renderedBody = renderTemplate(body, SAMPLE_CTX);
  const targetCount = startFresh ? active.total_contacts : active.eligible_contacts;
  const isDirty = subject !== active.subject_tmpl || body !== active.body_tmpl;

  function insertVar(token: string) {
    const ta = document.getElementById("master-body") as HTMLTextAreaElement | null;
    if (!ta) { setBody(prev => prev + token); return; }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + token.length, start + token.length); }, 0);
  }

  function handleSaveOnly() {
    if (!active) return;
    if (!isDirty) { toast.info("No changes to save."); return; }
    setBusy("save");
    startTransition(async () => {
      const r = await saveMasterTemplate(active.template_id, subject, body);
      setBusy(null);
      if (r.ok) {
        toast.success(`✓ Template saved (${active.campaign_name}).`);
        setOpen(false);
      } else toast.error(r.error ?? "Save failed.");
    });
  }

  function handleGenerate() {
    if (!active) return;
    if (targetCount === 0) { toast.error("No eligible contacts."); return; }
    const llmWarning = useLlm
      ? `\n\nGemini personalization adds ~2s per contact (~${Math.ceil(targetCount * 2 / 60)} min total).`
      : "";
    if (!confirm(`Create ${targetCount} draft email(s) for campaign "${active.campaign_name}" using the template below?${llmWarning}\n\nProceed?`)) return;

    setBusy("generate");
    startTransition(async () => {
      toast.info(useLlm
        ? `Generating ${targetCount} personalized drafts for ${active.campaign_name}…`
        : `Generating ${targetCount} drafts for ${active.campaign_name}…`);
      const r = await generateDrafts({
        overrideSubject: isDirty ? subject : undefined,
        overrideBody: isDirty ? body : undefined,
        useLlm, startFresh,
        campaignName: active.campaign_name,
      });
      setBusy(null);
      if (r.ok) {
        toast.success(`✓ Created ${r.created} draft${r.created === 1 ? "" : "s"} in ${active.campaign_name}.`);
        setOpen(false);
      } else {
        toast.error(r.error ?? "Failed.");
      }
    });
  }

  const triggerLabel = mode === "edit" ? "Edit template" : "Generate drafts";
  const TriggerIcon = mode === "edit" ? Pencil : Sparkles;
  const triggerClass = mode === "edit"
    ? "bg-slate-800 text-white hover:bg-slate-700 border-slate-700"
    : "bg-white text-slate-900 hover:bg-slate-100 border-white";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={triggerClass}>
          <TriggerIcon className="h-4 w-4 mr-2" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Master email template</DialogTitle>
          <DialogDescription>
            Pick which campaign template to edit / generate from. Each campaign
            has its own template (e.g. internship outreach vs SaaS sales pitch).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {campaigns.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap p-3 bg-violet-50 rounded-md border border-violet-200">
              <Label className="text-xs font-semibold uppercase tracking-wide text-violet-700">
                Campaign:
              </Label>
              {campaigns.map(c => (
                <button
                  key={c.campaign_name}
                  type="button"
                  onClick={() => pickCampaign(c.campaign_name)}
                  className={`text-xs px-3 py-1.5 rounded-md border font-medium transition-colors ${
                    c.campaign_name === active.campaign_name
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {c.campaign_name}
                  <span className="ml-1.5 opacity-70 text-[10px]">
                    ({c.eligible_contacts} eligible)
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">
              {targetCount} draft{targetCount === 1 ? "" : "s"} will be created in <strong className="ml-1">{active.campaign_name}</strong>
              {startFresh
                ? ` (replacing existing pending drafts)`
                : ` (${active.total_contacts - active.eligible_contacts} contacts already drafted, skipped)`}
            </Badge>
            {isDirty && <Badge variant="warning">Unsaved edits</Badge>}
          </div>

          <div>
            <Label htmlFor="master-subject">Subject</Label>
            <Input id="master-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label htmlFor="master-body">Body</Label>
              <div className="flex gap-1 flex-wrap">
                {VARS.map((t) => (
                  <button
                    key={t} type="button" onClick={() => insertVar(t)}
                    className="text-[10px] rounded bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 font-mono text-slate-700"
                  >{t}</button>
                ))}
              </div>
            </div>
            <Textarea id="master-body" value={body} onChange={(e) => setBody(e.target.value)} rows={16} className="text-xs" />
            <p className="text-[10px] text-slate-400 mt-1">
              Use <code className="rounded bg-slate-100 px-1">**bold**</code> for emphasis, <code className="rounded bg-slate-100 px-1">{`{{var}}`}</code> for substitution.
            </p>
          </div>

          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} className="h-3.5 w-3.5" />
              Use Gemini to personalize {`{{company_brief_one_line}}`} per company (slower)
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={startFresh} onChange={(e) => setStartFresh(e.target.checked)} className="h-3.5 w-3.5" />
              Start fresh (delete existing pending drafts first)
            </label>
            <button type="button" onClick={() => setShowPreview(!showPreview)} className="text-blue-600 hover:underline">
              <Eye className="h-3 w-3 inline mr-1" /> {showPreview ? "Hide" : "Show"} preview
            </button>
          </div>

          {showPreview && (
            <div className="border border-slate-200 rounded-md bg-slate-50 p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Preview (sample data: {SAMPLE_CTX.first_name} / {SAMPLE_CTX.company})</div>
              <div className="font-medium text-sm">{renderedSubject}</div>
              <div className="text-sm bg-white rounded p-3 border max-h-72 overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: plainToBoldHtml(renderedBody) }} />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose asChild>
            <Button variant="ghost" disabled={isPending}>Cancel</Button>
          </DialogClose>
          <Button variant="outline" onClick={handleSaveOnly} disabled={isPending || !isDirty}>
            {busy === "save"
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
              : <><Save className="h-4 w-4 mr-2" /> Save changes only</>}
          </Button>
          <Button onClick={handleGenerate} disabled={isPending || targetCount === 0}>
            {busy === "generate"
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
              : <><Sparkles className="h-4 w-4 mr-2" /> Save & generate {targetCount} drafts</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
