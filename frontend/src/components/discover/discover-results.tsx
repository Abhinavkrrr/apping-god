"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { UserPlus, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { addDiscoveredToContacts, type DiscoveredPerson } from "@/app/actions/discover";
import { generateDraftsForContacts } from "@/app/actions/send";

export function DiscoverResults({ people, totalAvailable }: {
  people: DiscoveredPerson[]; totalAvailable: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(people.filter(p => p.email).map(p => p.apollo_id))
  );
  const [batchLabel, setBatchLabel] = useState(`Apollo · ${new Date().toLocaleDateString("en-IN")}`);
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [isPending, startTransition] = useTransition();

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    setSelected(next);
  }

  const eligible = people.filter(p => p.email);

  function add() {
    if (selected.size === 0) { toast.error("Select at least one person."); return; }
    if (!batchLabel.trim()) { toast.error("Give them a batch label."); return; }
    const toAdd = people.filter(p => selected.has(p.apollo_id) && p.email);
    if (toAdd.length === 0) {
      toast.error("Selected people don't have emails."); return;
    }

    startTransition(async () => {
      toast.info(autoGenerate
        ? `Adding ${toAdd.length} contact(s) + generating drafts…`
        : `Adding ${toAdd.length} contact(s)…`);
      const r = await addDiscoveredToContacts({
        people: toAdd, batchLabel, autoGenerate,
      });
      if (!r.ok) { toast.error(r.error ?? "Failed."); return; }

      const parts: string[] = [];
      if (r.imported > 0) parts.push(`✓ ${r.imported} new`);
      if (r.updated > 0) parts.push(`↻ ${r.updated} updated`);
      if (r.failed > 0) parts.push(`✗ ${r.failed} failed`);
      if (typeof r.drafts_created === "number") {
        parts.push(`📝 ${r.drafts_created} draft${r.drafts_created === 1 ? "" : "s"} in Approve queue`);
      }
      toast.success(parts.join(" · "));
    });
  }

  if (people.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">No results</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b border-slate-100 pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              Results
              <Badge variant="info">{people.length} returned</Badge>
              {totalAvailable > people.length && (
                <Badge variant="default">of {totalAvailable.toLocaleString()} matching</Badge>
              )}
              <Badge variant="success">{eligible.length} with email</Badge>
            </CardTitle>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <Label className="text-xs">Batch label</Label>
            <Input value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)}
              className="mt-1" />
          </div>
          <div className="flex flex-col justify-end">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={autoGenerate}
                onChange={(e) => setAutoGenerate(e.target.checked)} className="h-4 w-4" />
              <span>
                <strong>Auto-generate drafts</strong>
                <span className="text-slate-500 ml-1">(land in Approve queue immediately)</span>
              </span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-2">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox"
              checked={selected.size === eligible.length && eligible.length > 0}
              onChange={(e) => setSelected(e.target.checked ? new Set(eligible.map(p => p.apollo_id)) : new Set())}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span className="font-medium text-slate-700">
              Select all with email ({eligible.length})
            </span>
          </label>
          <Button onClick={add} disabled={isPending || selected.size === 0} size="sm">
            {isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adding…</>
              : <><UserPlus className="h-4 w-4 mr-2" /> Add {selected.size} to contacts</>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 w-10"></th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Title</th>
                <th className="px-3 py-2 text-left font-medium">Company</th>
                <th className="px-3 py-2 text-left font-medium">Email</th>
                <th className="px-3 py-2 text-left font-medium">LinkedIn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {people.map(p => {
                const hasEmail = !!p.email;
                return (
                  <tr key={p.apollo_id} className={hasEmail ? "hover:bg-slate-50" : "bg-slate-50 opacity-60"}>
                    <td className="px-3 py-2">
                      <input type="checkbox"
                        checked={selected.has(p.apollo_id)}
                        onChange={(e) => toggle(p.apollo_id, e.target.checked)}
                        disabled={!hasEmail}
                        className="h-4 w-4 rounded border-slate-300 disabled:opacity-30"
                      />
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {p.full_name || "—"}
                      {p.providers && p.providers.length > 0 && (
                        <span className="block text-[9px] text-slate-400 mt-0.5">
                          via {p.providers.join("+")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{p.title || "—"}</td>
                    <td className="px-3 py-2 text-slate-700">{p.company_name}</td>
                    <td className="px-3 py-2">
                      {hasEmail ? (
                        <div className="flex items-center gap-1">
                          <span className="text-slate-700 text-xs">{p.email}</span>
                          {p.email_status && <Badge variant="default" className="text-[9px]">{p.email_status}</Badge>}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">(not revealed)</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {p.linkedin_url && (
                        <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-0.5 text-xs">
                          link <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
