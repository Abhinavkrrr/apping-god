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
import { Sparkles, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { renderTemplate, plainToBoldHtml, SAMPLE_CTX } from "@/lib/utils/mustache";
import { generateDrafts } from "@/app/actions/send";

const VARS = ["{{first_name}}", "{{company}}", "{{company_brief_one_line}}", "{{full_name}}", "{{title}}"];

interface Props {
  initial: {
    subject_tmpl: string;
    body_tmpl: string;
    eligible_contacts: number;
    total_contacts: number;
  };
}

export function GenerateModal({ initial }: Props) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(initial.subject_tmpl);
  const [body, setBody] = useState(initial.body_tmpl);
  const [useLlm, setUseLlm] = useState(false);
  const [startFresh, setStartFresh] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [isPending, startTransition] = useTransition();

  const renderedSubject = renderTemplate(subject, SAMPLE_CTX);
  const renderedBody = renderTemplate(body, SAMPLE_CTX);
  const targetCount = startFresh ? initial.total_contacts : initial.eligible_contacts;

  function insertVar(token: string) {
    const ta = document.getElementById("master-body") as HTMLTextAreaElement | null;
    if (!ta) { setBody(prev => prev + token); return; }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + token.length, start + token.length); }, 0);
  }

  function handleGenerate() {
    if (targetCount === 0) { toast.error("No eligible contacts."); return; }
    const llmWarning = useLlm
      ? `\n\nGemini personalization adds ~2s per contact (~${Math.ceil(targetCount * 2 / 60)} min total).`
      : "";
    if (!confirm(`This will create ${targetCount} draft email(s) using the template you just edited.${llmWarning}\n\nProceed?`)) return;

    startTransition(async () => {
      toast.info(useLlm
        ? `Generating ${targetCount} personalized drafts... could take ${Math.ceil(targetCount * 2 / 60)} min.`
        : `Generating ${targetCount} drafts... please wait.`);
      const r = await generateDrafts({
        overrideSubject: subject !== initial.subject_tmpl ? subject : undefined,
        overrideBody: body !== initial.body_tmpl ? body : undefined,
        useLlm, startFresh,
      });
      if (r.ok) {
        toast.success(`✓ Created ${r.created} draft${r.created === 1 ? "" : "s"}.`);
        setOpen(false);
      } else {
        toast.error(r.error ?? "Failed.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-white text-slate-900 hover:bg-slate-100 border-white">
          <Sparkles className="h-4 w-4 mr-2" /> Generate drafts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Generate drafts for all contacts</DialogTitle>
          <DialogDescription>
            Edit the master template below. When you click Generate, this exact template
            will be applied to every contact (with their name, company, etc. substituted).
            <br />
            <Badge variant="info" className="mt-2">
              {targetCount} draft{targetCount === 1 ? "" : "s"} will be created
              {startFresh
                ? ` (replacing all existing pending drafts)`
                : ` (${initial.total_contacts - initial.eligible_contacts} contacts already drafted, skipped)`}
            </Badge>
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

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={isPending}>Cancel</Button>
          </DialogClose>
          <Button onClick={handleGenerate} disabled={isPending || targetCount === 0}>
            {isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
              : <><Sparkles className="h-4 w-4 mr-2" /> Generate {targetCount} drafts</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
