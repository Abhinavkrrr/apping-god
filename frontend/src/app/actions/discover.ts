"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { generateDraftsForContacts } from "@/app/actions/send";

export interface DiscoveredPerson {
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  email_status: string | null;     // 'verified' | 'risky' | etc.
  title: string | null;
  linkedin_url: string | null;
  company_name: string;
  company_domain: string | null;
  apollo_id: string;               // unique-ish id (we generate "domain:email")
}

interface DiscoverInput {
  domains: string[];           // ['cred.club', 'linear.app']
  titles: string[];            // ['Founder', 'Product Manager'] — filtered client-side
  per_page?: number;           // default 25; max 100 (Hunter limit)
}

interface DiscoverResult {
  ok: boolean;
  people: DiscoveredPerson[];
  total: number;
  error?: string;
}

// Map Hunter's confidence (0-100) to our email_status
function statusFromScore(score: number | null | undefined): string {
  if (score == null) return "unverified";
  if (score >= 80) return "verified";
  if (score >= 50) return "risky";
  return "guess";
}

/** Match a person's title against any of the search keywords (case-insensitive substring). */
function matchesTitle(position: string | null | undefined, keywords: string[]): boolean {
  if (!keywords.length) return true;
  if (!position) return false;
  const p = position.toLowerCase();
  return keywords.some(k => p.includes(k.toLowerCase()));
}

/** Search via Hunter's domain-search — free tier 25/month, up to 100 results each. */
export async function discoverViaApollo(input: DiscoverInput): Promise<DiscoverResult> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) {
    return { ok: false, people: [], total: 0, error: "HUNTER_API_KEY not set in .env" };
  }
  if (!input.domains || input.domains.length === 0) {
    return { ok: false, people: [], total: 0, error: "At least one company domain is required." };
  }

  const allPeople: DiscoveredPerson[] = [];
  const errors: string[] = [];
  let totalFromAllDomains = 0;
  // Hunter free tier caps at 10 results per domain-search. Asking for more
  // returns HTTP 400 'pagination_error'. We clamp here so the request always
  // succeeds; paid plans support up to 100.
  const perDomain = Math.min(input.per_page ?? 10, 10);

  for (const domain of input.domains) {
    try {
      const url = new URL("https://api.hunter.io/v2/domain-search");
      url.searchParams.set("domain", domain);
      url.searchParams.set("limit", String(perDomain));
      url.searchParams.set("api_key", key);
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const txt = await res.text();
        errors.push(`${domain}: HTTP ${res.status} — ${txt.slice(0, 150)}`);
        continue;
      }
      const json = await res.json();
      const orgName = json?.data?.organization ?? domain;
      const allEmails = json?.data?.emails ?? [];
      totalFromAllDomains += allEmails.length;

      for (const e of allEmails) {
        if (!e.value) continue;
        if (!matchesTitle(e.position, input.titles)) continue;
        allPeople.push({
          first_name: e.first_name ?? "",
          last_name: e.last_name ?? "",
          full_name: [e.first_name, e.last_name].filter(Boolean).join(" "),
          email: e.value,
          email_status: statusFromScore(e.confidence),
          title: e.position ?? null,
          linkedin_url: e.linkedin ?? null,
          company_name: orgName,
          company_domain: domain,
          apollo_id: `${domain}:${e.value}`,
        });
      }
    } catch (err) {
      errors.push(`${domain}: ${err instanceof Error ? err.message : "fetch failed"}`);
    }
  }

  // Dedupe by email
  const seen = new Set<string>();
  const deduped: DiscoveredPerson[] = [];
  for (const p of allPeople) {
    const key = p.email?.toLowerCase() ?? p.apollo_id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }

  if (deduped.length === 0 && errors.length > 0) {
    return { ok: false, people: [], total: totalFromAllDomains, error: errors.join(" · ") };
  }

  return {
    ok: true,
    people: deduped,
    total: totalFromAllDomains,
    ...(errors.length > 0 ? { error: `Some domains failed: ${errors.join(" · ")}` } : {}),
  };
}

/** Apollo-based "fill missing email" — now unused since Hunter returns emails inline.
 * Kept as a no-op for backwards compatibility with discover-form.tsx. */
export async function fillEmailViaHunter(people: DiscoveredPerson[]): Promise<DiscoveredPerson[]> {
  return people;
}

/** Add discovered people as contacts with a batch label.
 *  If autoGenerate=true (default), also creates pending_approval drafts
 *  for the inserted/updated contacts so they show up in /approve immediately. */
export async function addDiscoveredToContacts(opts: {
  people: DiscoveredPerson[];
  batchLabel: string;
  autoGenerate?: boolean;
}): Promise<{
  ok: boolean;
  imported: number;
  updated: number;
  failed: number;
  drafts_created?: number;
  drafts_skipped?: number;
  error?: string;
}> {
  if (!opts.batchLabel?.trim()) {
    return { ok: false, imported: 0, updated: 0, failed: 0, error: "Batch label required." };
  }
  if (!opts.people || opts.people.length === 0) {
    return { ok: false, imported: 0, updated: 0, failed: 0, error: "No people selected." };
  }

  const sb = createAdminClient();
  let imported = 0, updated = 0, failed = 0;
  const contactIds: string[] = [];

  for (const p of opts.people) {
    const email = (p.email ?? "").toLowerCase().trim();
    if (!email || !email.includes("@") || !p.first_name) { failed++; continue; }

    let company_id: string | null = null;
    if (p.company_name) {
      const { data: existingCo } = await sb.from("companies").select("id")
        .ilike("name", p.company_name).maybeSingle();
      if (existingCo) {
        company_id = existingCo.id;
        if (p.company_domain) await sb.from("companies").update({ domain: p.company_domain }).eq("id", company_id);
      } else {
        const { data: created } = await sb.from("companies").insert({
          name: p.company_name, domain: p.company_domain,
        }).select("id").single();
        company_id = created?.id ?? null;
      }
    }

    const { data: existing } = await sb.from("contacts").select("id, custom_fields")
      .eq("email", email).maybeSingle();

    const cf = { batch_label: opts.batchLabel.trim(), source_id: p.apollo_id };
    const emailStatus = p.email_status === "verified" ? "valid"
      : p.email_status === "guess" ? "risky" : "unverified";

    if (existing) {
      const merged = { ...((existing.custom_fields as object) ?? {}), ...cf };
      await sb.from("contacts").update({
        first_name: p.first_name, last_name: p.last_name || null,
        title: p.title, linkedin_url: p.linkedin_url, company_id,
        custom_fields: merged, email_status: emailStatus,
      }).eq("id", existing.id);
      contactIds.push(existing.id);
      updated++;
    } else {
      const { data: created, error } = await sb.from("contacts").insert({
        first_name: p.first_name, last_name: p.last_name || null,
        email, company_id, title: p.title, linkedin_url: p.linkedin_url,
        source: "hunter-discover", custom_fields: cf, email_status: emailStatus,
      }).select("id").single();
      if (error || !created) failed++;
      else { contactIds.push(created.id); imported++; }
    }
  }

  // Auto-generate drafts for these contacts so they land in /approve immediately
  let drafts_created: number | undefined;
  let drafts_skipped: number | undefined;
  const autoGen = opts.autoGenerate ?? true;
  if (autoGen && contactIds.length > 0) {
    const g = await generateDraftsForContacts(contactIds);
    if (g.ok) {
      drafts_created = g.created ?? 0;
      drafts_skipped = g.skipped ?? 0;
    }
  }

  revalidatePath("/contacts");
  revalidatePath("/approve");
  revalidatePath("/");
  return { ok: true, imported, updated, failed, drafts_created, drafts_skipped };
}
