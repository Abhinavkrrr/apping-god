"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteAccount, pauseAccount, resumeAccount } from "@/app/actions/accounts";

interface Props {
  account: {
    id: string;
    email: string;
    daily_cap: number;
    sent_today: number;
    warmup_phase: string;
    warmup_start_date: string | null;
    paused_until: string | null;
    health_score: number;
  };
}

const phaseVariant: Record<string, "success" | "warning" | "destructive" | "default"> = {
  active: "success", warmup: "warning", paused: "default", dead: "destructive",
};

export function AccountRow({ account: a }: Props) {
  const [isPending, startTransition] = useTransition();
  const isPaused = a.warmup_phase === "paused";

  function togglePause() {
    startTransition(async () => {
      const r = isPaused ? await resumeAccount(a.id) : await pauseAccount(a.id, 24);
      if (r.ok) toast.success(isPaused ? "Resumed" : "Paused for 24h");
      else toast.error("Failed.");
    });
  }

  function remove() {
    if (!confirm(`Delete ${a.email}? Existing sends from this account stay in DB.`)) return;
    startTransition(async () => {
      const r = await deleteAccount(a.id);
      if (r.ok) toast.success("Deleted.");
      else toast.error("Failed.");
    });
  }

  return (
    <div className="flex items-center gap-3 p-4 border-b border-slate-100 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm flex items-center gap-2">
          {a.email}
          <Badge variant={phaseVariant[a.warmup_phase] ?? "default"}>{a.warmup_phase}</Badge>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          <span className="font-medium">{a.sent_today}</span> / {a.daily_cap} sent today
          {a.warmup_start_date && a.warmup_phase === "warmup" && (
            <> · warmup started {new Date(a.warmup_start_date).toLocaleDateString()}</>
          )}
          {a.paused_until && new Date(a.paused_until) > new Date() && (
            <> · paused until {new Date(a.paused_until).toLocaleString()}</>
          )}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={togglePause} disabled={isPending}>
        {isPaused ? <><Play className="h-3.5 w-3.5 mr-1" /> Resume</> : <><Pause className="h-3.5 w-3.5 mr-1" /> Pause 24h</>}
      </Button>
      <Button variant="ghost" size="sm" onClick={remove} disabled={isPending}>
        <Trash2 className="h-3.5 w-3.5 text-red-600" />
      </Button>
    </div>
  );
}
