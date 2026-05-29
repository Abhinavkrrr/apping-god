"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import {
  AlertCircle, Database, Wand2, Loader2, Copy, Check, X, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { migratePotentialBounces } from "@/app/actions/bounces";

const MIGRATION_SQL = `-- Apply once in Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS bounces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id         uuid REFERENCES public.sends(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  bounce_type     text NOT NULL CHECK (bounce_type IN ('hard','soft','unknown')),
  failed_recipient text,
  smtp_status     text,
  diagnostic      text,
  from_daemon     text,
  raw_body        text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bounces_contact_id ON bounces (contact_id);
CREATE INDEX IF NOT EXISTS idx_bounces_send_id    ON bounces (send_id);
CREATE INDEX IF NOT EXISTS idx_bounces_received_at ON bounces (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_bounces_type       ON bounces (bounce_type);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_bounces_send_status_day
  ON bounces (send_id, smtp_status, (received_at::date))
  WHERE send_id IS NOT NULL;`;

export function MigrateBouncesBanner({
  tableExists,
  potentialCount,
  potentialPreview,
}: {
  tableExists: boolean;
  potentialCount: number;
  potentialPreview: Array<{ name: string; recipient: string; type: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [sqlOpen, setSqlOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Case 1: table missing ─────────────────────────────────────────
  if (!tableExists) {
    return (
      <>
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <Database className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-red-900 text-sm">
                The <code className="bg-red-100 px-1.5 py-0.5 rounded text-xs">bounces</code> table doesn't exist in your DB yet
              </div>
              <p className="text-xs text-red-800 mt-1 leading-relaxed">
                That's why this page is empty even though there are bounces in your inbox.
                The new bounce-detection code is running — it just has nowhere to write the results.
                {potentialCount > 0 && (
                  <span className="block mt-1.5 font-medium">
                    Found <span className="font-bold">{potentialCount}</span> bounce-pattern message{potentialCount === 1 ? "" : "s"} sitting in your <code className="bg-red-100 px-1 rounded">replies</code> table waiting to be migrated.
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap pl-8">
            <Button size="sm" onClick={() => setSqlOpen(true)} className="bg-red-600 hover:bg-red-700 text-white">
              <Database className="h-3.5 w-3.5 mr-1.5" /> Show migration SQL
            </Button>
            <a
              href="https://supabase.com/dashboard/project/ouzfrefnhlxhpeyufllt/sql/new"
              target="_blank" rel="noopener noreferrer"
            >
              <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-100">
                Open Supabase SQL Editor <ExternalLink className="h-3 w-3 ml-1.5" />
              </Button>
            </a>
          </div>
          <div className="text-[11px] text-red-700/80 pl-8 leading-relaxed">
            ↪ Once the table is created, refresh this page and a green "Migrate {potentialCount} bounces from inbox" button will appear.
          </div>
        </div>

        <Dialog open={sqlOpen} onOpenChange={setSqlOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create the bounces table</DialogTitle>
              <DialogDescription>
                Copy this SQL → paste into Supabase Dashboard → SQL Editor → click Run.
                Takes 1 second. Idempotent — safe if you ran it before.
              </DialogDescription>
            </DialogHeader>
            <div className="relative">
              <pre className="bg-slate-900 text-emerald-200 text-[11px] p-4 rounded-md overflow-x-auto max-h-96 font-mono">
                <code>{MIGRATION_SQL}</code>
              </pre>
              <Button
                size="sm" variant="outline"
                className="absolute top-2 right-2 h-7 px-2 text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(MIGRATION_SQL);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                  toast.success("SQL copied to clipboard");
                }}
              >
                {copied
                  ? <><Check className="h-3 w-3 mr-1" /> Copied</>
                  : <><Copy className="h-3 w-3 mr-1" /> Copy</>}
              </Button>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost"><X className="h-4 w-4 mr-1" /> Close</Button>
              </DialogClose>
              <a
                href="https://supabase.com/dashboard/project/ouzfrefnhlxhpeyufllt/sql/new"
                target="_blank" rel="noopener noreferrer"
              >
                <Button>Open SQL Editor <ExternalLink className="h-3 w-3 ml-1.5" /></Button>
              </a>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ── Case 2: table exists + nothing to migrate → render nothing ────
  if (potentialCount === 0) return null;

  // ── Case 3: table exists + potential bounces hiding in replies ────
  function handleMigrate() {
    if (!confirm(
      `Migrate ${potentialCount} bounce${potentialCount === 1 ? "" : "s"} from your inbox into this page?\n\n` +
      `For each:\n` +
      `  • Add a row to the bounces table\n` +
      `  • Mark the contact as bounced (won't be re-pitched)\n` +
      `  • Cancel any pending drafts to that contact\n` +
      `  • Remove the entry from /inbox\n\n` +
      `Idempotent — safe to re-run.`
    )) return;
    setBusy(true);
    startTransition(async () => {
      const r = await migratePotentialBounces();
      setBusy(false);
      if (!r.ok) {
        if (r.error_code === "TABLE_MISSING") {
          toast.error("Bounces table is missing — apply the migration first.");
          setSqlOpen(true);
        } else {
          toast.error(r.error ?? "Migration failed.");
        }
        return;
      }
      toast.success(
        `✓ Migrated ${r.migrated} bounce${r.migrated === 1 ? "" : "s"}` +
        ` · Blocked ${r.contacts_blocked} contact${r.contacts_blocked === 1 ? "" : "s"}` +
        (r.sends_cancelled ? ` · Cancelled ${r.sends_cancelled} pending send${r.sends_cancelled === 1 ? "" : "s"}` : ""),
        { duration: 8000 }
      );
    });
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="font-semibold text-amber-900 text-sm">
            {potentialCount} bounce{potentialCount === 1 ? "" : "s"} detected in your inbox
          </div>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">
            These look like delivery failures sitting in your Reply inbox.
            Click below to migrate them into this page, block the contacts, and cancel any
            pending drafts to those addresses.
          </p>
          {potentialPreview.length > 0 && (
            <ul className="text-xs text-amber-800 mt-2 space-y-0.5">
              {potentialPreview.map((p, i) => (
                <li key={i} className="font-mono">
                  • <span className={`uppercase text-[10px] font-bold px-1 rounded mr-1 ${
                    p.type === "hard" ? "bg-red-200 text-red-800" :
                    p.type === "soft" ? "bg-amber-200 text-amber-800" :
                    "bg-slate-200 text-slate-700"
                  }`}>{p.type}</span>
                  {p.recipient}
                </li>
              ))}
              {potentialCount > potentialPreview.length && (
                <li className="text-amber-700 italic">… and {potentialCount - potentialPreview.length} more</li>
              )}
            </ul>
          )}
        </div>
      </div>
      <div className="pl-8">
        <Button size="sm" onClick={handleMigrate} disabled={busy} className="bg-amber-600 hover:bg-amber-700 text-white">
          {busy
            ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Migrating…</>
            : <><Wand2 className="h-3.5 w-3.5 mr-1.5" /> Migrate {potentialCount} bounce{potentialCount === 1 ? "" : "s"} from inbox</>}
        </Button>
      </div>
    </div>
  );
}
