"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { setDefaultResume, deleteResume } from "@/app/actions/resumes";

interface Props {
  resumeId: string;
  isDefault: boolean;
}

export function ResumeActions({ resumeId, isDefault }: Props) {
  const [isPending, startTransition] = useTransition();

  function makeDefault() {
    startTransition(async () => {
      const r = await setDefaultResume(resumeId);
      if (r.ok) toast.success("Set as default.");
      else toast.error("Failed.");
    });
  }

  function remove() {
    if (!confirm("Delete this resume? Sends already attached to it will keep working.")) return;
    startTransition(async () => {
      const r = await deleteResume(resumeId);
      if (r.ok) toast.success("Deleted.");
      else toast.error("Failed.");
    });
  }

  return (
    <div className="flex gap-2">
      {!isDefault && (
        <Button variant="outline" size="sm" onClick={makeDefault} disabled={isPending}>
          <Star className="h-3.5 w-3.5 mr-1.5" /> Make default
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={remove} disabled={isPending}>
        <Trash2 className="h-3.5 w-3.5 text-red-600" />
      </Button>
    </div>
  );
}
