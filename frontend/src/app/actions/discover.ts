"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { generateDraftsForContacts } from "@/app/actions/send";
import { searchDomainAllProviders, enabledProviders } from "@/lib/discover/providers";

export interface DiscoveredPerson {
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  email_status: string | null;
  title: string | null;
  linkedin_url: string | null;
  company_name: string;
  company_domain: string | null;
  apollo_id: string;        // legacy field name — actually source_id
  providers: string[];      // ["hunter", "snov", ...] — which providers found this person
}

interface DiscoverInput {
  domains: string[];
  titles: string[];
  per_page?: number;        // per-domain per-provider limit
}

interface DiscoverResult {
  ok: boolean;
  people: DiscoveredPerson[];
  total: number;
  per_provider?: { name: string; ok: boolean; count: number; error?: string }[];
  enabled_providers?: string[];
  error?: string;
}

function statusFromConfidence(c: number | null | undefined): string {
  if (c == null) return "unverified";
  if (c >= 80) return "verified";
  if (c >= 50) return "risky";
  return "guess";
}

function matchesTitle(position: string | null | undefined, keywords: string[]): boolean {
  if (!keywords.length) return true;
  if (!position) return false;
  const p = position.toLowerCase();
  return keywords.some(k => p.includes(k.toLowerCase()));
}

/** Search ALL enabled providers in parallel for each domain. Dedupes by email. */
export async function discoverViaApollo(input: DiscoverInput): Promise<DiscoverResult> {
  const providers = enabledProviders();
  if (providers.length === 0) {
    return { ok: false, people: [], total: 0, error: "No providers enabled. Add API keys in .env (HUNTER_API_KEY, SNOV_USER_ID/SECRET, SALESQL_API_KEY, CONTACTOUT_API_KEY, SKRAPP_API_KEY, ROCKETREACH_API_KEY)." };
  }
  if (!input.domains || input.domains.length === 0) {
    return { ok: false, people: [], total: 0, error: "At least one company domain is required." };
  }

  // Run all domains in parallel; each domain runs all providers in parallel
  const domainResults = await Promise.all(
    input.domains.map(d => searchDomainAllProviders(d, { limit: input.per_page ?? 10 }))
  );

  // Combine across domains, dedupe again by email
  const merged = new Map<string, DiscoveredPerson>();
  let totalIndexed = 0;
  const providerStats = new Map<string, { ok: boolean; count: number; error?: string }>();

  for (const dr of domainResults) {
    totalIndexed += dr.total_indexed;
    for (const ps of dr.per_provider) {
      const cur = providerStats.get(ps.name) ?? { ok: true, count: 0 };
      providerStats.set(ps.name, {
        ok: cur.ok && ps.ok,
        count: cur.count + ps.count,
        error: ps.error ?? cur.error,
      });
    }
    for (const p of dr.people) {
      if (!matchesTitle(p.title, input.titles)) continue;
      const key = p.email.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        for (const pr of p.providers) {
          if (!existing.providers.includes(pr)) existing.providers.push(pr);
        }
      } else {
        merged.set(key, {
          first_name: p.first_name,
          last_name: p.last_name,
          full_name: [p.first_name, p.last_name].filter(Boolean).join(" "),
          email: p.email,
          email_status: statusFromConfidence(p.confidence),
          title: p.title,
          linkedin_url: p.linkedin_url,
          company_name: p.company_name,
          company_domain: p.company_domain,
          apollo_id: p.source_id,
          providers: [...p.providers],
        });
      }
    }
  }

  const people = Array.from(merged.values());

  return {
    ok: true,
    people,
    total: totalIndexed,
    per_provider: Array.from(providerStats.entries()).map(([name, s]) => ({
      name, ok: s.ok, count: s.count, error: s.error,
    })),
    enabled_providers: providers.map(p => p.name),
  };
}

/** Legacy compat — no longer used since providers return emails inline. */
export async function fillEmailViaHunter(people: DiscoveredPerson[]): Promise<DiscoveredPerson[]> {
  return people;
}

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

    const cf = {
      batch_label: opts.batchLabel.trim(),
      source_id: p.apollo_id,
      providers: p.providers,
    };
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
        source: p.providers.join("+") || "discover",
        custom_fields: cf, email_status: emailStatus,
      }).select("id").single();
      if (error || !created) failed++;
      else { contactIds.push(created.id); imported++; }
    }
  }

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

/** Surface enabled providers to the UI for the badge row. */
export async function listEnabledProviders(): Promise<string[]> {
  return enabledProviders().map(p => p.name);
}
