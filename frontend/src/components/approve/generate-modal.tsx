"use client";

import { useState, useTransition } from "react";
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

interface Props {
  initial: {
    template_id: string;
    subject_tmpl: string;
    body_tmpl: string;
    eligible_contacts: number;
    total_contacts: number;
  };
  mode?: "edit" | "generate";
}

export function GenerateModal({ initial, mode = "generate" }: Props) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(initial.subject_tmpl);
  const [body, setBody] = useState(initial.body_tmpl);
  const [useLlm, setUseLlm] = useState(false);
  const [startFresh, setStartFresh] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [busy, setBusy] = useState<"save" | "generate" | null>(null);
  const [isPending, startTransition] = useTransition();

  // When modal opens, re-sync state with the latest server-side initial
  // (so edits made on Templates page show up here).
  function handleOpenChange(next: boolean) {
    if (next) {
      setSubject(initial.subject_tmpl);
      setBody(initial.body_tmpl);
    }
    setOpen(next);
  }

  const renderedSubject = renderTemplate(subject, SAMPLE_CTX);
  const renderedBody = renderTemplate(body, SAMPLE_CTX);
  const targetCount = startFresh ? initial.total_contacts : initial.eligible_contacts;
  const isDirty = subject !== initial.subject_tmpl || body !== initial.body_tmpl;

  function insertVar(token: string) {
    const ta = document.getElementById("master-body") as HTMLTextAreaElement | null;
    if (!ta) { setBody(prev => prev + token); return; }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + token.length, start + token.length); }, 0);
  }

  function handleSaveOnly() {
    if (!isDirty) { toast.info("No changes to save."); return; }
    setBusy("save");
    startTransition(async () => {
      const r = await saveMasterTemplate(initial.template_id, subject, body);
      setBusy(null);
      if (r.ok) {
        toast.success("✓ Template saved.");
        setOpen(false);
      } else toast.error(r.error ?? "Save failed.");
    });
  }

  function handleGenerate() {
    if (targetCount === 0) { toast.error("No eligible contacts."); return; }
    const llmWarning = useLlm
      ? `\n\nGemini personalization adds ~2s per contact (~${Math.ceil(targetCount * 2 / 60)} min total).`
      : "";
    if (!confirm(`This will create ${targetCount} draft email(s) using the template you just edited.${llmWarning}\n\nProceed?`)) return;

    setBusy("generate");
    startTransition(async () => {
      toast.info(useLlm
        ? `Generating ${targetCount} personalized drafts... could take ${Math.ceil(targetCount * 2 / 60)} min.`
        : `Generating ${targetCount} drafts... please wait.`);
      const r = await generateDrafts({
        overrideSubject: isDirty ? subject : undefined,
        overrideBody: isDirty ? body : undefined,
        useLlm, startFresh,
      });
      setBusy(null);
      if (r.ok) {
        toast.success(`✓ Created ${r.created} draft${r.created === 1 ? "" : "s"}.`);
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
            Edit the subject and body below. Click <strong>Save</strong> to just save edits, or
            <strong> Generate</strong> to save and create one draft per contact.
            <br />
            <Badge variant="info" className="mt-2">
              {targetCount} draft{targetCount === 1 ? "" : "s"} will be created
              {startFresh
                ? ` (replacing all existing pending drafts)`
                : ` (${initial.total_contacts - initial.eligible_contacts} contacts already drafted, skipped)`}
            </Badge>
            {isDirty && <Badge variant="warning" className="ml-2 mt-2">Unsaved edits</Badge>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
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
