"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Pencil, Eye } from "lucide-react";
import { toast } from "sonner";
import { renderTemplate, plainToBoldHtml, SAMPLE_CTX } from "@/lib/utils/mustache";
import { updateTemplate } from "@/app/actions/templates";

interface Template {
  id: string;
  subject_tmpl: string;
  body_tmpl: string;
  variant_label: string | null;
  is_followup: boolean;
  followup_step: number | null;
  campaign_id: string;
  personalization_level: "light" | "medium";
}

interface Props {
  template: Template;
  campaignName: string;
}

const VARIABLE_TOKENS = [
  "{{first_name}}", "{{company}}", "{{company_brief_one_line}}",
  "{{full_name}}", "{{title}}",
];

export function TemplateEditor({ template, campaignName }: Props) {
  const [open, setOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [subject, setSubject] = useState(template.subject_tmpl);
  const [body, setBody] = useState(template.body_tmpl);
  const [isPending, startTransition] = useTransition();

  const renderedSubject = renderTemplate(subject, SAMPLE_CTX);
  const renderedBody = renderTemplate(body, SAMPLE_CTX);

  function insertVar(token: string) {
    const ta = document.getElementById(`body-${template.id}`) as HTMLTextAreaElement | null;
    if (!ta) {
      setBody(prev => prev + token);
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  }

  function handleSave() {
    startTransition(async () => {
      const res = await updateTemplate(template.id, { subject_tmpl: subject, body_tmpl: body });
      if (res.ok) {
        toast.success(`Saved "${template.variant_label}"`);
        setOpen(false);
      } else {
        toast.error(`Save failed: ${res.error}`);
      }
    });
  }

  const stepLabel = template.is_followup
    ? `Follow-up #${template.followup_step}`
    : "First touch";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {campaignName} · {stepLabel}
            <Badge variant="info">{template.variant_label}</Badge>
          </DialogTitle>
          <DialogDescription>
            Use <code className="rounded bg-slate-100 px-1 text-xs">{`{{variable}}`}</code> for substitution
            and <code className="rounded bg-slate-100 px-1 text-xs">**bold**</code> for emphasis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor={`subj-${template.id}`}>Subject</Label>
            <Input
              id={`subj-${template.id}`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label htmlFor={`body-${template.id}`}>Body</Label>
              <div className="flex gap-1 flex-wrap">
                {VARIABLE_TOKENS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => insertVar(t)}
                    className="text-[10px] rounded bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 font-mono text-slate-700"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <Textarea
              id={`body-${template.id}`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={18}
              className="text-xs"
            />
          </div>

          <Button variant="outline" size="sm" onClick={() => setShowPreview(s => !s)}>
            <Eye className="h-3.5 w-3.5 mr-1.5" />
            {showPreview ? "Hide preview" : "Show rendered preview"}
          </Button>

          {showPreview && (
            <div className="border border-slate-200 rounded-md bg-slate-50 p-4 space-y-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">Subject</div>
              <div className="font-medium">{renderedSubject}</div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mt-3">Body</div>
              <div
                className="text-sm leading-relaxed text-slate-700 bg-white rounded p-3 border"
                dangerouslySetInnerHTML={{ __html: plainToBoldHtml(renderedBody) }}
              />
              <p className="text-[11px] text-slate-400 mt-2">
                Preview uses sample data: {SAMPLE_CTX.first_name} / {SAMPLE_CTX.company}.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
