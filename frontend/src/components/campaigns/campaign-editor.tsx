"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateCampaign } from "@/app/actions/campaigns";

interface Resume { id: string; label: string; is_default: boolean; }
interface Campaign {
  id: string; name: string; target_role: string | null;
  resume_id: string | null;
  send_window_local_hour: number; send_window_local_minute: number;
  send_days: number[];
  status: "draft" | "active" | "paused" | "archived";
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CampaignEditor({ campaign, resumes }: { campaign: Campaign; resumes: Resume[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [targetRole, setTargetRole] = useState(campaign.target_role || "");
  const [resumeId, setResumeId] = useState(campaign.resume_id || "");
  const [hour, setHour] = useState(campaign.send_window_local_hour);
  const [minute, setMinute] = useState(campaign.send_window_local_minute);
  const [days, setDays] = useState<number[]>(campaign.send_days || [1, 2, 3, 4, 5]);
  const [status, setStatus] = useState(campaign.status);
  const [isPending, startTransition] = useTransition();

  function toggleDay(d: number) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }

  function handleSave() {
    startTransition(async () => {
      const r = await updateCampaign(campaign.id, {
        name, target_role: targetRole || undefined,
        resume_id: resumeId || null,
        send_window_local_hour: hour, send_window_local_minute: minute,
        send_days: days, status,
      });
      if (r.ok) {
        toast.success("Saved.");
        setOpen(false);
      } else toast.error(`Save failed: ${r.error}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit campaign</DialogTitle>
          <DialogDescription>Send window is in recipient&apos;s local timezone.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Target role</Label>
            <Input value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="e.g., Product Management Internship" className="mt-1" />
          </div>
          <div>
            <Label>Status</Label>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              value={status} onChange={(e) => setStatus(e.target.value as Campaign["status"])}
            >
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="archived">archived</option>
            </select>
          </div>
          <div>
            <Label>Resume</Label>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              value={resumeId} onChange={(e) => setResumeId(e.target.value)}
            >
              <option value="">(use default resume)</option>
              {resumes.map(r => (
                <option key={r.id} value={r.id}>{r.label}{r.is_default ? " (default)" : ""}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Send hour (24h)</Label>
              <Input type="number" min={0} max={23} value={hour} onChange={(e) => setHour(parseInt(e.target.value || "10"))} className="mt-1" />
            </div>
            <div>
              <Label>Send minute</Label>
              <Input type="number" min={0} max={59} value={minute} onChange={(e) => setMinute(parseInt(e.target.value || "30"))} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Send days</Label>
            <div className="flex gap-1 mt-1">
              {DAY_NAMES.map((d, i) => {
                const iso = i + 1;
                const on = days.includes(iso);
                return (
                  <button
                    key={d} type="button" onClick={() => toggleDay(iso)}
                    className={`flex-1 text-xs px-2 py-1 rounded border ${on ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300"}`}
                  >{d}</button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
