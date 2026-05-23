"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

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
  apollo_id: string;
}

interface DiscoverInput {
  domains: string[];           // ['stripe.com', 'linear.app']
  titles: string[];            // ['Founder', 'CEO', 'Recruiter']
  location?: string;           // e.g. 'India', 'United States'
  per_page?: number;           // default 25, max 100
  page?: number;               // default 1
}

interface DiscoverResult {
  ok: boolean;
  people: DiscoveredPerson[];
  total: number;
  page: number;
  error?: string;
}

/** Search Apollo for people matching the given criteria. */
export async function discoverViaApollo(input: DiscoverInput): Promise<DiscoverResult> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) {
    return { ok: false, people: [], total: 0, page: 1, error: "APOLLO_API_KEY not set in .env" };
  }
  if (!input.domains || input.domains.length === 0) {
    return { ok: false, people: [], total: 0, page: 1, error: "At least one company domain is required." };
  }
  if (!input.titles || input.titles.length === 0) {
    return { ok: false, people: [], total: 0, page: 1, error: "At least one title keyword is required." };
  }

  const body: Record<string, unknown> = {
    q_organization_domains_list: input.domains,
    person_titles: input.titles,
    page: input.page ?? 1,
    per_page: Math.min(input.per_page ?? 25, 100),
  };
  if (input.location) body.person_locations = [input.location];

  try {
    const res = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
      method: "POST",
      headers: {
        "X-Api-Key": key,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, people: [], total: 0, page: 1, error: `Apollo HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }
    const json = await res.json();
    const total = json?.pagination?.total_entries ?? 0;
    const people: DiscoveredPerson[] = (json?.people ?? []).map((p: any) => ({
      first_name: p.first_name ?? "",
      last_name: p.last_name ?? "",
      full_name: p.name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      email: p.email ?? null,
      email_status: p.email_status ?? null,
      title: p.title ?? null,
      linkedin_url: p.linkedin_url ?? null,
      company_name: p.organization?.name ?? "",
      company_domain: p.organization?.primary_domain ?? p.organization?.website_url ?? null,
      apollo_id: p.id ?? "",
    }));

    return { ok: true, people, total, page: input.page ?? 1 };
  } catch (e) {
    return {
      ok: false, people: [], total: 0, page: 1,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

/** Use Hunter to find emails for people Apollo couldn't reveal. */
export async function fillEmailViaHunter(people: DiscoveredPerson[]): Promise<DiscoveredPerson[]> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return people;

  const out: DiscoveredPerson[] = [];
  for (const p of people) {
    if (p.email || !p.company_domain || !p.first_name) {
      out.push(p); continue;
    }
    const domain = p.company_domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    try {
      const url = new URL("https://api.hunter.io/v2/email-finder");
      url.searchParams.set("domain", domain);
      url.searchParams.set("first_name", p.first_name);
      if (p.last_name) url.searchParams.set("last_name", p.last_name);
      url.searchParams.set("api_key", key);
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        if (j?.data?.email) {
          out.push({
            ...p,
            email: j.data.email,
            email_status: j.data.score >= 80 ? "verified" : "risky",
          });
          continue;
        }
      }
    } catch { /* ignore, just skip */ }
    out.push(p);
  }
  return out;
}

/** Add discovered people as contacts with a batch label. */
export async function addDiscoveredToContacts(opts: {
  people: DiscoveredPerson[];
  batchLabel: string;
}): Promise<{ ok: boolean; imported: number; updated: number; failed: number; error?: string }> {
  if (!opts.batchLabel?.trim()) {
    return { ok: false, imported: 0, updated: 0, failed: 0, error: "Batch label required." };
  }
  if (!opts.people || opts.people.length === 0) {
    return { ok: false, imported: 0, updated: 0, failed: 0, error: "No people selected." };
  }

  const sb = createAdminClient();
  let imported = 0, updated = 0, failed = 0;

  for (const p of opts.people) {
    const email = (p.email ?? "").toLowerCase().trim();
    if (!email || !email.includes("@") || !p.first_name) { failed++; continue; }

    // Upsert company
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

    // Check existing contact
    const { data: existing } = await sb.from("contacts").select("id, custom_fields")
      .eq("email", email).maybeSingle();

    const cf = { batch_label: opts.batchLabel.trim(), apollo_id: p.apollo_id };

    if (existing) {
      const merged = { ...((existing.custom_fields as object) ?? {}), ...cf };
      await sb.from("contacts").update({
        first_name: p.first_name, last_name: p.last_name || null,
        title: p.title, linkedin_url: p.linkedin_url, company_id,
        custom_fields: merged,
      }).eq("id", existing.id);
      updated++;
    } else {
      const { error } = await sb.from("contacts").insert({
        first_name: p.first_name, last_name: p.last_name || null,
        email, company_id, title: p.title, linkedin_url: p.linkedin_url,
        source: "apollo-discover", custom_fields: cf,
      });
      if (error) failed++;
      else imported++;
    }
  }

  revalidatePath("/contacts");
  revalidatePath("/approve");
  revalidatePath("/");
  return { ok: true, imported, updated, failed };
}
