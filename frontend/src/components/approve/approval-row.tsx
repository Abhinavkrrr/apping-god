"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { X, Eye, Send, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { rejectSend, dispatchNow } from "@/app/actions/approvals";
import { personalizeSingleSend } from "@/app/actions/personalize";
import { loadDraftBody } from "@/app/actions/drafts";

interface Draft {
  id: string;
  rendered_subject: string;
  rendered_body: string;
  contact_email: string;
  contact_name: string;
  company_name: string;
  campaign_name: string;
}

export function ApprovalRow({ draft, checked, onCheck }: {
  draft: Draft; checked: boolean; onCheck: (v: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [subject, setSubject] = useState(draft.rendered_subject);
  const [body, setBody] = useState(draft.rendered_body);
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function ensureBody() {
    if (bodyLoaded || bodyLoading) return;
    setBodyLoading(true);
    try {
      const r = await loadDraftBody(draft.id);
      if (r.ok) {
        setSubject(r.subject ?? subject);
        setBody(r.body ?? "");
        setBodyLoaded(true);
      } else {
        toast.error("Couldn't load body — try refresh");
      }
    } finally {
      setBodyLoading(false);
    }
  }

  function togglePreview() {
    if (!expanded) ensureBody();
    setExpanded(!expanded);
  }

  function reject() {
    if (!confirm(`Reject draft to ${draft.contact_email}? It won't be sent.`)) return;
    startTransition(async () => {
      const r = await rejectSend(draft.id);
      if (r.ok) toast.success(`Rejected ${draft.contact_email}`);
      else toast.error("Reject failed");
    });
  }

  function personalize() {
    startTransition(async () => {
      toast.info(`Asking AI to personalize for ${draft.company_name}…`);
      const r = await personalizeSingleSend(draft.id);
      if (r.ok) {
        toast.success(`✨ Rewritten — open Preview to see`);
        setBodyLoaded(false); // force refetch on next Preview open
      } else {
        toast.error(r.error ?? "Personalization failed");
      }
    });
  }

  function send() {
    startTransition(async () => {
      const r = await dispatchNow(draft.id);
      if (r.ok) toast.success(`✓ Sent to ${draft.contact_email}`);
      else toast.error(`Failed: ${JSON.stringify(r.result).slice(0, 80)}`);
    });
  }

  return (
    <div className="border border-slate-200 rounded-md bg-white">
      <div className="flex items-center gap-3 p-3 border-b border-slate-100">
        <input
          type="checkbox" checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">
            {draft.contact_name}{" "}
            <span className="text-slate-400 font-normal">&lt;{draft.contact_email}&gt;</span>
          </div>
          <div className="text-xs text-slate-500">{draft.company_name}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={togglePreview}>
          <Eye className="h-3.5 w-3.5 mr-1" /> {expanded ? "Hide" : "Preview"}
        </Button>
        <Button variant="outline" size="sm" onClick={personalize} disabled={isPending}
          title={`Rewrite this email specifically for ${draft.company_name}`}>
          {isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <><Sparkles className="h-3.5 w-3.5 mr-1 text-violet-600" /> AI</>}
        </Button>
        <Button variant="ghost" size="sm" onClick={reject} disabled={isPending} title="Reject">
          <X className="h-3.5 w-3.5 text-red-600" />
        </Button>
        <Button size="sm" onClick={send} disabled={isPending}>
          <Send className="h-3.5 w-3.5 mr-1" /> Send
        </Button>
      </div>
      {expanded && (
        <div className="p-3 space-y-2 bg-slate-50">
          {bodyLoading ? (
            <div className="flex items-center gap-2 p-3 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading body…
            </div>
          ) : (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Subject</div>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="bg-white" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Body (HTML)</div>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="bg-white text-[11px]" />
              </div>
              <div
                className="text-sm bg-white p-3 rounded border border-slate-200"
                dangerouslySetInnerHTML={{ __html: body }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
