"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { discoverViaApollo, fillEmailViaHunter, type DiscoveredPerson } from "@/app/actions/discover";
import { DiscoverResults } from "./discover-results";

const TITLE_PRESETS = [
  { label: "VC + investors", titles: "Partner, Principal, Associate, Investor, Venture Partner" },
  { label: "Founders", titles: "Founder, Co-founder, CEO" },
  { label: "PM hiring", titles: "Head of Product, VP Product, Product Manager, Director of Product" },
  { label: "Recruiters", titles: "Recruiter, Talent Acquisition, University Relations, Campus Recruiter" },
  { label: "Founder's Office", titles: "Chief of Staff, Founder's Office, CEO's Office, Strategy" },
];

export function DiscoverForm() {
  const [domainsText, setDomainsText] = useState("");
  const [titles, setTitles] = useState("");
  const [location, setLocation] = useState("");
  const [perPage, setPerPage] = useState(25);
  const [useHunterFill, setUseHunterFill] = useState(true);
  const [people, setPeople] = useState<DiscoveredPerson[] | null>(null);
  const [total, setTotal] = useState(0);
  const [isPending, startTransition] = useTransition();

  function search() {
    const domains = domainsText.split(/[\n,]/).map(s => s.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean);
    const titlesArr = titles.split(",").map(s => s.trim()).filter(Boolean);
    if (domains.length === 0) { toast.error("Add at least one company domain."); return; }
    if (titlesArr.length === 0) { toast.error("Add at least one title keyword."); return; }

    startTransition(async () => {
      toast.info(`Searching Apollo for ${titlesArr.length} title(s) across ${domains.length} compan${domains.length === 1 ? "y" : "ies"}…`);
      const res = await discoverViaApollo({
        domains, titles: titlesArr, location: location || undefined, per_page: perPage,
      });
      if (!res.ok) {
        toast.error(`Search failed: ${res.error}`);
        return;
      }
      if (res.people.length === 0) {
        toast.info("No people found. Try broader titles or different domains.");
        setPeople([]); setTotal(0);
        return;
      }

      let enriched = res.people;
      if (useHunterFill) {
        const missing = enriched.filter(p => !p.email).length;
        if (missing > 0) {
          toast.info(`Looking up ${missing} email(s) via Hunter…`);
          enriched = await fillEmailViaHunter(enriched);
        }
      }
      setPeople(enriched); setTotal(res.total);
      toast.success(`✓ Found ${res.people.length} (of ${res.total} total)`);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search criteria</CardTitle>
          <CardDescription>
            Apollo&apos;s 270M-person database. Free tier ~60 searches/month + 60 email reveals.
            Combined with Hunter (25/month) for emails Apollo can&apos;t reveal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Company domains *</Label>
            <Textarea value={domainsText} onChange={(e) => setDomainsText(e.target.value)}
              rows={3}
              placeholder="stripe.com&#10;linear.app&#10;perplexity.ai&#10;cred.club"
              className="mt-1 font-mono text-xs" />
            <p className="text-[10px] text-slate-500 mt-1">
              One per line. Strip the http/path: <code>stripe.com</code> not <code>https://stripe.com/about</code>.
            </p>
          </div>

          <div>
            <Label>Title keywords *</Label>
            <Input value={titles} onChange={(e) => setTitles(e.target.value)}
              placeholder="Founder, CEO, Recruiter, Head of Product" className="mt-1" />
            <div className="flex flex-wrap gap-1 mt-2">
              {TITLE_PRESETS.map(p => (
                <button key={p.label} type="button" onClick={() => setTitles(p.titles)}
                  className="text-[10px] rounded bg-slate-100 hover:bg-slate-200 px-2 py-1 text-slate-700">
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Location (optional)</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. India, United States" className="mt-1" />
            </div>
            <div>
              <Label>Results per page</Label>
              <Input type="number" min={5} max={100} value={perPage}
                onChange={(e) => setPerPage(parseInt(e.target.value || "25"))} className="mt-1" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={useHunterFill}
              onChange={(e) => setUseHunterFill(e.target.checked)} className="h-4 w-4" />
            <span>
              <strong>Use Hunter to find missing emails</strong>
              <span className="text-slate-500 ml-1">
                (extra ~1 sec per person without an email; counts against Hunter free tier)
              </span>
            </span>
          </label>

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
