"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  const [perPage, setPerPage] = useState(100);
  const [people, setPeople] = useState<DiscoveredPerson[] | null>(null);
  const [total, setTotal] = useState(0);
  const [isPending, startTransition] = useTransition();

  function search() {
    const domains = domainsText
      .split(/[\n,]/)
      .map(s => s.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
      .filter(Boolean);
    const titlesArr = titles.split(",").map(s => s.trim()).filter(Boolean);
    if (domains.length === 0) { toast.error("Add at least one company domain."); return; }

    startTransition(async () => {
      toast.info(`Searching Hunter for ${domains.length} domain${domains.length === 1 ? "" : "s"}… (uses ${domains.length} credit${domains.length === 1 ? "" : "s"} of your 25/month)`);
      const res = await discoverViaApollo({ domains, titles: titlesArr, per_page: perPage });
      if (!res.ok) { toast.error(`Search failed: ${res.error}`); return; }
      if (res.people.length === 0) {
        if (res.total > 0) toast.info(`Hunter has ${res.total} email(s) for those domains but NONE matched your title keywords. Try fewer or broader titles, or leave empty to see everyone.`);
        else toast.info("Hunter has no emails indexed for those domains yet. Try a more well-known company.");
        setPeople([]); setTotal(res.total);
        return;
      }
      setPeople(res.people); setTotal(res.total);
      toast.success(`✓ ${res.people.length} matched (Hunter has ${res.total} total for these domains)`);
      if (res.error) toast.warning(res.error.slice(0, 200));
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search criteria</CardTitle>
          <CardDescription>
            Hunter.io scans the web for emails published at the domain you give it
            (about pages, press releases, GitHub commits, etc.) and returns a list
            of all employees with their names, titles, and emails. Free tier:{" "}
            <strong>25 domain searches/month</strong>, up to 100 emails per search.
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
              One per line. Strip http/path: <code>cred.club</code>, not <code>https://cred.club/about</code>.
              Each domain costs 1 Hunter credit.
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
            <p className="text-[10px] text-slate-500 mt-1">
              Case-insensitive substring match on Hunter&apos;s &quot;position&quot; field.
              <strong> If you get 0 matches, try leaving this blank</strong> to see what titles Hunter has.
            </p>
          </div>

          <div>
            <Label>Max results per domain</Label>
            <Input type="number" min={10} max={100} value={perPage}
              onChange={(e) => setPerPage(parseInt(e.target.value || "100"))} className="mt-1 w-32" />
          </div>

          <Button onClick={search} disabled={isPending} className="w-full">
            {isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Searching…</>
              : <><Search className="h-4 w-4 mr-2" /> Search</>}
          </Button>
        </CardContent>
      </Card>

      {people !== null && <DiscoverResults people={people} totalAvailable={total} />}
    </div>
  );
}
