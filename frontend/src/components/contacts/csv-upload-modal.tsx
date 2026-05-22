"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Papa from "papaparse";
import { bulkImportContacts } from "@/app/actions/contacts";

interface ParsedRow {
  first_name: string;
  last_name?: string;
  email: string;
  company_name?: string;
  company_brief?: string;
  title?: string;
}

export function CsvUploadModal() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [batchLabel, setBatchLabel] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleFile(file: File) {
    // Auto-fill batch name from filename (stripped of extension)
    if (!batchLabel) {
      setBatchLabel(file.name.replace(/\.[^.]+$/, "").trim());
    }
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const errs: string[] = [];
        const parsed: ParsedRow[] = [];
        for (const r of res.data) {
          const nameParts = (r.name ?? "").trim().split(/\s+/);
          const first = nameParts[0] || r.first_name || "";
          const last = nameParts.slice(1).join(" ") || r.last_name || "";
          const email = (r.email ?? "").trim().toLowerCase();
          if (!first || !email) { errs.push(`Skip: ${JSON.stringify(r).slice(0, 60)}`); continue; }
          parsed.push({
            first_name: first, last_name: last || undefined, email,
            company_name: r.company || undefined,
            company_brief: r.company_brief || undefined,
            title: r.title || undefined,
          });
        }
        setRows(parsed); setErrors(errs);
        toast.info(`Parsed ${parsed.length} contacts${errs.length > 0 ? `, skipped ${errs.length}` : ""}.`);
      },
    });
  }

  function handleImport() {
    if (rows.length === 0) { toast.error("No rows parsed."); return; }
    if (!batchLabel.trim()) { toast.error("Give this batch a name so you can find it later."); return; }
    if (!confirm(`Import ${rows.length} contacts under batch "${batchLabel.trim()}"?`)) return;
    startTransition(async () => {
      toast.info(`Importing ${rows.length}...`);
      const r = await bulkImportContacts(rows, batchLabel.trim());
      if (r.ok) {
        toast.success(`✓ Imported: ${r.imported} · Failed: ${r.failed}`);
        setOpen(false); setRows([]); setErrors([]); setBatchLabel("");
      } else toast.error("Import failed.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Upload className="h-4 w-4 mr-2" /> Import CSV</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import contacts from CSV</DialogTitle>
          <DialogDescription>
            Expected columns: <code className="text-xs bg-slate-100 px-1 rounded">name</code> (or first_name + last_name),
            <code className="text-xs bg-slate-100 px-1 rounded mx-1">email</code>,
            <code className="text-xs bg-slate-100 px-1 rounded">company</code>,
            <code className="text-xs bg-slate-100 px-1 rounded mx-1">company_brief</code>,
            <code className="text-xs bg-slate-100 px-1 rounded">title</code>.
            Email is required. Extra columns are ignored.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Batch name *</Label>
            <Input value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)}
              placeholder="e.g. VCs March 2026, AI startups, Razorpay contacts"
              className="mt-1" />
            <p className="text-[10px] text-slate-500 mt-1">
              Every contact in this CSV gets tagged with this batch — so you can filter and generate drafts
              just for this batch later.
            </p>
          </div>
          <div>
            <Label>CSV file</Label>
            <Input type="file" accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="mt-1" />
          </div>

          {rows.length > 0 && (
            <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
              <div className="text-xs font-medium text-slate-700 mb-2">
                Preview ({rows.length} parsed, {errors.length} skipped)
              </div>
              <div className="max-h-48 overflow-y-auto text-xs space-y-1 font-mono">
                {rows.slice(0, 10).map((r, i) => (
                  <div key={i} className="text-slate-600 truncate">
                    {r.first_name} {r.last_name} &lt;{r.email}&gt; · {r.company_name ?? "—"}
                  </div>
                ))}
                {rows.length > 10 && <div className="text-slate-400">…and {rows.length - 10} more</div>}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={handleImport} disabled={isPending || rows.length === 0 || !batchLabel.trim()}>
            {isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing…</>
              : `Import ${rows.length} contacts`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
