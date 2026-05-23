"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { discoverViaApollo, type DiscoveredPerson } from "@/app/actions/discover";
import { DiscoverResults } from "./discover-results";

const TITLE_PRESETS = [
  { label: "All employees", titles: "" },
  { label: "VC + investors", titles: "Partner, Principal, Associate, Investor, Venture" },
  { label: "Founders", titles: "Founder, Co-founder, CEO" },
  { label: "PM hiring", titles: "Head of Product, VP Product, Product Manager, Director of Product" },
  { label: "Recruiters", titles: "Recruiter, Talent, University, Campus" },
  { label: "Founder's Office", titles: "Chief of Staff, Founder, Strategy, EA" },
];

export function DiscoverForm() {
  const [domainsText, setDomainsText] = useState("");
  const [titles, setTitles] = useState("");
  const [perPage, setPerPage] = useState(10);
  const [people, setPeople] = useState<DiscoveredPerson[] | null>(null);
  const [total, setTotal] = useState(0);
  const [perProvider, setPerProvider] = useState<{ name: string; ok: boolean; count: number; error?: string }[]>([]);
  const [enabledProvs, setEnabledProvs] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  function search() {
    const domains = domainsText
      .split(/[\n,]/)
      .map(s => s.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
      .filter(Boolean);
    const titlesArr = titles.split(",").map(s => s.trim()).filter(Boolean);
    if (domains.length === 0) { toast.error("Add at least one company domain."); return; }

    startTransition(async () => {
      toast.info(`Searching across all providers for ${domains.length} domain${domains.length === 1 ? "" : "s"}…`);
      const res = await discoverViaApollo({ domains, titles: titlesArr, per_page: perPage });
      if (!res.ok) { toast.error(`Search failed: ${res.error}`); return; }
      setPerProvider(res.per_provider ?? []);
      setEnabledProvs(res.enabled_providers ?? []);
      if (res.people.length === 0) {
        if (res.total > 0) toast.info(`Providers returned ${res.total} email(s) but NONE matched your title keywords. Try broader titles or leave empty.`);
        else toast.info("No providers had any data for these domains. Try a more well-known company.");
        setPeople([]); setTotal(res.total);
        return;
      }
      setPeople(res.people); setTotal(res.total);
      const provSummary = res.per_provider?.map(p => `${p.name}:${p.count}`).join(" · ") ?? "";
      toast.success(`✓ ${res.people.length} unique matched · sources: ${provSummary}`);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search criteria</CardTitle>
          <CardDescription>
            Runs every enabled provider <strong>in parallel</strong> and dedupes results
            by email. Combined free-tier capacity: ~75 searches/month
            (Hunter 25 + Snov 50). Add SalesQL / ContactOut / Skrapp / RocketReach
            keys to <code className="text-[10px] bg-slate-100 px-1 rounded">.env</code>
            to plug them in automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Company domains *</Label>
            <Textarea value={domainsText} onChange={(e) => setDomainsText(e.target.value)}
              rows={3}
              placeholder="cred.club&#10;linear.app&#10;perplexity.ai"
              className="mt-1 font-mono text-xs" />
            <p className="text-[10px] text-slate-500 mt-1">
              One per line. Each domain costs 1 credit on each enabled provider.
            </p>
          </div>

          <div>
            <Label>Title keywords (optional — leave blank for ALL employees)</Label>
            <Input value={titles} onChange={(e) => setTitles(e.target.value)}
              placeholder="Founder, CEO, Product Manager" className="mt-1" />
            <div className="flex flex-wrap gap-1 mt-2">
              {TITLE_PRESETS.map(p => (
                <button key={p.label} type="button" onClick={() => setTitles(p.titles)}
                  className="text-[10px] rounded bg-slate-100 hover:bg-slate-200 px-2 py-1 text-slate-700">
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Max results per domain per provider</Label>
            <Input type="number" min={1} max={100} value={perPage}
              onChange={(e) => setPerPage(Math.min(parseInt(e.target.value || "10"), 100))} className="mt-1 w-32" />
            <p className="text-[10px] text-slate-500 mt-1">
              Hunter free tier caps at <strong>10 per search</strong>. Snov free up to ~100.
              Higher values use more credits proportionally.
            </p>
          </div>

          <Button onClick={search} disabled={isPending} className="w-full">
            {isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Searching…</>
              : <><Search className="h-4 w-4 mr-2" /> Search</>}
          </Button>
        </CardContent>
      </Card>

      {perProvider.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Last search · per-provider breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {perProvider.map(p => (
                <Badge key={p.name} variant={p.ok && p.count > 0 ? "success" : p.ok ? "default" : "destructive"}>
                  {p.name}: {p.count}
                  {p.error && p.error.length < 60 && <span className="ml-1 opacity-75">({p.error})</span>}
                </Badge>
              ))}
              {enabledProvs.length === 1 && (
                <span className="text-slate-400 text-[10px] ml-2">
                  Only {enabledProvs[0]} enabled. Add more keys to .env to scale up.
                </span>
              )}
              {enabledProvs.length > 1 && (
                <span className="text-slate-400 text-[10px] ml-2">
                  {enabledProvs.length} providers running in parallel — overlapping people are deduped.
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {people !== null && <DiscoverResults people={people} totalAvailable={total} />}
    </div>
  );
}
