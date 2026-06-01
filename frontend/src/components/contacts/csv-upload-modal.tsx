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
import * as XLSX from "xlsx";
import { bulkImportContacts } from "@/app/actions/contacts";
import { generateDraftsForContacts } from "@/app/actions/send";

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
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Shared row-mapping pipeline. Takes header row + data rows, returns
  // the parsed contacts (or null if no email column was detected).
  function mapRowsToContacts(
    headers: string[],
    dataRows: Record<string, string>[]
  ): { parsed: ParsedRow[]; skips: { reason: string; sample: string }[]; map: Record<string, string | null> } | null {
    const map = detectColumns(headers);
    if (!map.email) {
      toast.error(`No email column found. Your file's headers: ${headers.join(", ")}`);
      return null;
    }

    const parsed: ParsedRow[] = [];
    const skips: { reason: string; sample: string }[] = [];

    for (const r of dataRows) {
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

    return { parsed, skips, map };
  }

  function handleFile(file: File) {
    if (!batchLabel) {
      setBatchLabel(file.name.replace(/\.[^.]+$/, "").trim());
    }
    setRows([]); setDetected(null); setSkipped([]);

    // Detect format by extension. Excel (.xlsx, .xls, .xlsm, .xlsb, .ods)
    // → SheetJS. CSV / TSV / TXT → papaparse.
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isExcel = ["xlsx", "xls", "xlsm", "xlsb", "ods"].includes(ext);

    if (isExcel) {
      // SheetJS path. Read as ArrayBuffer, take first sheet, convert to
      // array-of-objects with string values so the same pipeline as CSV works.
      const reader = new FileReader();
      reader.onerror = () => toast.error("Could not read the file.");
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array" });
          const firstSheet = wb.SheetNames[0];
          if (!firstSheet) { toast.error("Excel file has no sheets."); return; }
          const sheet = wb.Sheets[firstSheet];

          // Convert sheet to objects. defval:"" ensures empty cells become
          // empty strings, not undefined — keeps the column-detection logic
          // consistent with CSV behavior.
          const rowsObj = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
            defval: "", raw: false,
          });
          if (rowsObj.length === 0) { toast.error(`Sheet "${firstSheet}" is empty.`); return; }

          // Coerce every cell to string for the pipeline
          const headers = Object.keys(rowsObj[0]);
          const dataRows: Record<string, string>[] = rowsObj.map(r => {
            const out: Record<string, string> = {};
            for (const k of headers) out[k] = String(r[k] ?? "").trim();
            return out;
          });

          const result = mapRowsToContacts(headers, dataRows);
          if (!result) return;
          setDetected(result.map);
          setRows(result.parsed); setSkipped(result.skips);
          toast.info(
            `Parsed ${result.parsed.length} contact(s) from "${firstSheet}" sheet` +
            (result.skips.length > 0 ? `, skipped ${result.skips.length}` : "") +
            (wb.SheetNames.length > 1 ? ` (file has ${wb.SheetNames.length} sheets; only the first was read)` : "")
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(`Excel parse failed: ${msg.slice(0, 120)}`);
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // CSV path (also handles .tsv if user renames — papaparse auto-detects delimiter)
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const headers = res.meta.fields ?? [];
        const result = mapRowsToContacts(headers, res.data);
        if (!result) return;
        setDetected(result.map);
        setRows(result.parsed); setSkipped(result.skips);
        toast.info(`Parsed ${result.parsed.length} contact(s)${result.skips.length > 0 ? `, skipped ${result.skips.length}` : ""}.`);
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

          // Auto-generate drafts for these contacts so they appear in Approve queue immediately
          if (autoGenerate && r.contact_ids && r.contact_ids.length > 0) {
            toast.info(`Generating drafts for ${r.contact_ids.length} contact(s)…`);
            const g = await generateDraftsForContacts(r.contact_ids);
            if (g.ok) {
              toast.success(`✓ ${g.created} new draft(s) in Approve queue${g.skipped ? ` · ${g.skipped} already had drafts` : ""}`);
            } else {
              toast.warning(`Drafts skipped: ${g.error}`);
            }
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
        <Button><Upload className="h-4 w-4 mr-2" /> Import CSV / Excel</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import contacts from CSV or Excel</DialogTitle>
          <DialogDescription>
            Accepts <strong>.csv</strong>, <strong>.xlsx</strong>, <strong>.xls</strong>, <strong>.xlsm</strong>, <strong>.xlsb</strong>, and <strong>.ods</strong>.
            For Excel files, only the <em>first sheet</em> is read.
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
            <Label>File (.csv / .xlsx / .xls / .ods)</Label>
            <Input
              type="file"
              accept=".csv,text/csv,.xlsx,.xls,.xlsm,.xlsb,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="mt-1"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox" checked={autoGenerate}
              onChange={(e) => setAutoGenerate(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>
              <strong>Generate drafts for these contacts after import</strong>
              <span className="text-xs text-slate-500 block">
                Imports go straight to the Approve queue — no need to click Generate Drafts.
              </span>
            </span>
          </label>

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
