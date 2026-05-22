"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

// Map of normalized canonical → list of accepted header variants (all lowercased).
const FIELD_ALIASES: Record<string, string[]> = {
  email: ["email", "email_address", "emailaddress", "e-mail", "e_mail", "mail", "primary email"],
  full_name: ["name", "full_name", "fullname", "full name", "contact", "contact name", "person", "person name"],
  first_name: ["first_name", "firstname", "first name", "first", "fname", "given name", "given_name"],
  last_name: ["last_name", "lastname", "last name", "last", "lname", "surname", "family name", "family_name"],
  company: ["company", "company_name", "companyname", "company name", "organization", "organisation", "org", "employer", "account"],
  company_brief: ["company_brief", "companybrief", "company brief", "brief", "description", "company description", "notes"],
  title: ["title", "job_title", "jobtitle", "job title", "role", "position", "designation"],
  linkedin: ["linkedin", "linkedin_url", "linkedinurl", "linkedin url", "linkedin profile", "li", "profile"],
};

/** Build a {canonical → actual_header} map for a given header row. */
function detectColumns(headers: string[]): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  const lowered = headers.map(h => ({ raw: h, low: h.trim().toLowerCase() }));
  for (const [canon, aliases] of Object.entries(FIELD_ALIASES)) {
    const found = lowered.find(h => aliases.includes(h.low));
    map[canon] = found?.raw ?? null;
  }
  return map;
}

function pick(row: Record<string, string>, header: string | null): string {
  if (!header) return "";
  return (row[header] ?? "").trim();
}

export function CsvUploadModal() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [detected, setDetected] = useState<Record<string, string | null> | null>(null);
  const [skipped, setSkipped] = useState<{ reason: string; sample: string }[]>([]);
  const [batchLabel, setBatchLabel] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleFile(file: File) {
    if (!batchLabel) {
      setBatchLabel(file.name.replace(/\.[^.]+$/, "").trim());
    }
    setRows([]); setDetected(null); setSkipped([]);

    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const headers = res.meta.fields ?? [];
        const map = detectColumns(headers);
        setDetected(map);

        if (!map.email) {
          toast.error(`No email column found. Your CSV headers: ${headers.join(", ")}`);
          return;
        }

        const parsed: ParsedRow[] = [];
        const skips: { reason: string; sample: string }[] = [];

        for (const r of res.data) {
          const email = pick(r, map.email).toLowerCase();
          if (!email || !email.includes("@")) {
            if (skips.length < 5) skips.push({ reason: "missing/invalid email", sample: JSON.stringify(r).slice(0, 80) });
            continue;
          }

          // Derive name: prefer first_name + last_name, fall back to full_name
          let first = pick(r, map.first_name);
          let last = pick(r, map.last_name);
          if (!first) {
            const full = pick(r, map.full_name);
            const parts = full.split(/\s+/).filter(Boolean);
            first = parts[0] ?? "";
            last = parts.slice(1).join(" ");
          }
          if (!first) {
            // Last resort: use the part of email before @
            first = email.split("@")[0].split(/[.\-_]/)[0];
            first = first.charAt(0).toUpperCase() + first.slice(1);
          }

          parsed.push({
            first_name: first,
            last_name: last || undefined,
            email,
            company_name: pick(r, map.company) || undefined,
            company_brief: pick(r, map.company_brief) || undefined,
            title: pick(r, map.title) || undefined,
          });
        }

        setRows(parsed); setSkipped(skips);
        toast.info(`Parsed ${parsed.length} contact(s)${skips.length > 0 ? `, skipped ${skips.length}` : ""}.`);
      },
      error: (e) => {
        toast.error(`CSV parse failed: ${e.message}`);
      },
    });
  }

  function handleImport() {
    if (rows.length === 0) { toast.error("No rows parsed — pick a CSV file first."); return; }
    if (!batchLabel.trim()) { toast.error("Give this batch a name."); return; }
    if (!confirm(`Import ${rows.length} contacts under batch "${batchLabel.trim()}"?\n\nDuplicate emails will be UPDATED (new batch tag added).`)) return;
    startTransition(async () => {
      toast.info(`Importing ${rows.length}... this may take ${Math.max(5, Math.ceil(rows.length * 0.1))}s.`);
      try {
        const r = await bulkImportContacts(rows, batchLabel.trim());
        if (r.ok) {
          const parts: string[] = [];
          if (r.imported > 0) parts.push(`✓ ${r.imported} new`);
          if (r.updated > 0) parts.push(`↻ ${r.updated} updated`);
          if (r.failed > 0) parts.push(`✗ ${r.failed} failed`);
          toast.success(parts.join(" · ") || "Done.");
          if (r.failed > 0 && r.sample_errors?.length) {
            console.error("Import failures:", r.sample_errors);
            toast.warning(`First error: ${r.sample_errors[0]}`);
          }
          setOpen(false); setRows([]); setDetected(null); setSkipped([]); setBatchLabel("");
        } else {
          toast.error("Import failed — check console.");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Import threw:", e);
        toast.error(`Threw: ${msg.slice(0, 120)}`);
      }
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
            Auto-detects column names (case-insensitive). Required: an email column. Recognized:
            <br />
            <code className="text-[11px] bg-slate-100 px-1 rounded">email</code>,{" "}
            <code className="text-[11px] bg-slate-100 px-1 rounded">name</code> (or{" "}
            <code className="text-[11px] bg-slate-100 px-1 rounded">first_name</code>/
            <code className="text-[11px] bg-slate-100 px-1 rounded">last_name</code>),{" "}
            <code className="text-[11px] bg-slate-100 px-1 rounded">company</code>,{" "}
            <code className="text-[11px] bg-slate-100 px-1 rounded">title</code>,{" "}
            <code className="text-[11px] bg-slate-100 px-1 rounded">company_brief</code>,{" "}
            <code className="text-[11px] bg-slate-100 px-1 rounded">linkedin</code>.
            <br />
            Variants like &quot;Email Address&quot;, &quot;Full Name&quot;, &quot;Company Name&quot;, &quot;Job Title&quot; all work.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Batch name *</Label>
            <Input value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)}
              placeholder="e.g. VCs March 2026" className="mt-1" />
          </div>
          <div>
            <Label>CSV file</Label>
            <Input type="file" accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="mt-1" />
          </div>

          {detected && (
            <div className="border border-slate-200 rounded-md p-3 bg-slate-50 space-y-2">
              <div className="text-xs font-medium text-slate-700">Column detection</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(detected).map(([canon, actual]) => (
                  <Badge key={canon} variant={actual ? "success" : "default"} className="text-[10px]">
                    {canon}: {actual ? `"${actual}"` : "—"}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
              <div className="text-xs font-medium text-slate-700 mb-2">
                Preview ({rows.length} parsed{skipped.length > 0 ? `, ${skipped.length} skipped` : ""})
              </div>
              <div className="max-h-40 overflow-y-auto text-xs space-y-1 font-mono">
                {rows.slice(0, 10).map((r, i) => (
                  <div key={i} className="text-slate-600 truncate">
                    {r.first_name} {r.last_name} &lt;{r.email}&gt; · {r.company_name ?? "—"}
                  </div>
                ))}
                {rows.length > 10 && <div className="text-slate-400">…and {rows.length - 10} more</div>}
              </div>
            </div>
          )}

          {skipped.length > 0 && (
            <div className="border border-amber-200 rounded-md p-3 bg-amber-50">
              <div className="text-xs font-medium text-amber-900 mb-1">
                Skipped {skipped.length} row(s)
              </div>
              <div className="text-[10px] text-amber-800 space-y-0.5 font-mono">
                {skipped.map((s, i) => <div key={i}>· {s.reason}: {s.sample}</div>)}
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
