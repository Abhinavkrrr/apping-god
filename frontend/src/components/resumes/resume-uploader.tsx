"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { uploadResume } from "@/app/actions/resumes";

export function ResumeUploader() {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    if (!file) { toast.error("Pick a PDF first."); return; }
    if (!label.trim()) { toast.error("Give it a label."); return; }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("label", label.trim());
    startTransition(async () => {
      const res = await uploadResume(fd);
      if (res.ok) {
        toast.success("Uploaded.");
        setOpen(false);
        setLabel(""); setFile(null);
      } else {
        toast.error(`Upload failed: ${res.error}`);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Upload className="h-4 w-4 mr-2" /> Upload resume</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload a resume PDF</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Label</Label>
            <Input
              placeholder="e.g., PM/Strategy resume v3"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>PDF file</Label>
            <Input
              type="file" accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
