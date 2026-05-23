// Multi-provider contact discovery.
//
// Each provider implements searchDomain(domain). The orchestrator runs all
// enabled providers in parallel per domain, dedupes by email, and tracks
// which provider(s) found each contact (for analytics + the UI badge).
//
// FREE TIER (auto-enabled if env keys present):
//   - Hunter.io       25 searches/mo, 10 results each
//   - Snov.io         ~50 searches/mo, 10 results each
//
// PAID / BYO-KEY (auto-enabled if env keys present):
//   - SalesQL         SALESQL_API_KEY in .env  (Pro plan)
//   - ContactOut      CONTACTOUT_API_KEY in .env  (Pro+)
//   - Skrapp          SKRAPP_API_KEY in .env  (Starter+)
//   - RocketReach     ROCKETREACH_API_KEY in .env  (Essentials+)
//
// To add a new provider: implement the Provider interface, register it in
// allProviders() below, and the orchestrator picks it up automatically.

export interface RawPerson {
  first_name: string;
  last_name: string;
  email: string;
  title: string | null;
  linkedin_url: string | null;
  confidence: number | null;        // 0-100; how sure the provider is the email works
  company_name: string;
  company_domain: string | null;
  source_provider: string;          // "hunter", "snov", "salesql", ...
  source_id: string;                // unique within the provider
}

export interface ProviderResult {
  ok: boolean;
  provider: string;
  people: RawPerson[];
  total_indexed: number;            // how many emails the provider has for this domain (not just returned)
  error?: string;
}

export interface Provider {
  name: string;
  isEnabled(): boolean;
  searchDomain(domain: string, opts: { limit?: number }): Promise<ProviderResult>;
}

// ─────────────────────────────────────────────────────────────────
// HUNTER.IO
// ─────────────────────────────────────────────────────────────────
const hunter: Provider = {
  name: "hunter",
  isEnabled() { return !!process.env.HUNTER_API_KEY; },
  async searchDomain(domain, { limit = 10 } = {}) {
    const key = process.env.HUNTER_API_KEY!;
    try {
      const url = new URL("https://api.hunter.io/v2/domain-search");
      url.searchParams.set("domain", domain);
      url.searchParams.set("limit", String(Math.min(limit, 10))); // free tier max
      url.searchParams.set("api_key", key);
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        return { ok: false, provider: "hunter", people: [], total_indexed: 0,
          error: `Hunter HTTP ${res.status}: ${(await res.text()).slice(0, 120)}` };
      }
      const json = await res.json();
      const orgName = json?.data?.organization ?? domain;
      const emails = json?.data?.emails ?? [];
      const people: RawPerson[] = emails
        .filter((e: any) => e.value)
        .map((e: any) => ({
          first_name: e.first_name ?? "",
          last_name: e.last_name ?? "",
          email: e.value,
          title: e.position ?? null,
          linkedin_url: e.linkedin ?? null,
          confidence: e.confidence ?? null,
          company_name: orgName,
          company_domain: domain,
          source_provider: "hunter",
          source_id: `hunter:${e.value}`,
        }));
      return { ok: true, provider: "hunter", people, total_indexed: emails.length };
    } catch (e) {
      return { ok: false, provider: "hunter", people: [], total_indexed: 0,
        error: e instanceof Error ? e.message : "Hunter fetch failed" };
    }
  },
};

// ─────────────────────────────────────────────────────────────────
// SNOV.IO  (v1 OAuth2 client-credentials)
// ─────────────────────────────────────────────────────────────────
let _snovToken: { value: string; expiresAt: number } | null = null;
async function getSnovToken(): Promise<string | null> {
  if (_snovToken && _snovToken.expiresAt > Date.now() + 30_000) return _snovToken.value;
  const id = process.env.SNOV_USER_ID, secret = process.env.SNOV_API_SECRET;
  if (!id || !secret) return null;
  const res = await fetch("https://api.snov.io/v1/oauth/access_token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  _snovToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return _snovToken.value;
}

const snov: Provider = {
  name: "snov",
  isEnabled() { return !!process.env.SNOV_USER_ID && !!process.env.SNOV_API_SECRET; },
  async searchDomain(domain, { limit = 10 } = {}) {
    try {
      const token = await getSnovToken();
      if (!token) return { ok: false, provider: "snov", people: [], total_indexed: 0, error: "Snov auth failed" };
      const url = new URL("https://api.snov.io/v2/domain-emails-with-info");
      url.searchParams.set("domain", domain);
      url.searchParams.set("type", "all");
      url.searchParams.set("limit", String(Math.min(limit, 100)));
      url.searchParams.set("access_token", token);
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        return { ok: false, provider: "snov", people: [], total_indexed: 0,
          error: `Snov HTTP ${res.status}: ${(await res.text()).slice(0, 120)}` };
      }
      const json = await res.json();
      const orgName = json?.domain ?? domain;
      const emails = json?.emails ?? [];
      const people: RawPerson[] = emails
        .filter((e: any) => e.email)
        .map((e: any) => ({
          first_name: e.firstName ?? e.first_name ?? "",
          last_name: e.lastName ?? e.last_name ?? "",
          email: e.email,
          title: e.position ?? null,
          linkedin_url: e.sourcePage ?? null,
          confidence: e.emailStatus === "verified" ? 95 : e.emailStatus === "valid" ? 85 : null,
          company_name: orgName,
          company_domain: domain,
          source_provider: "snov",
          source_id: `snov:${e.email}`,
        }));
      return { ok: true, provider: "snov", people, total_indexed: emails.length };
    } catch (e) {
      return { ok: false, provider: "snov", people: [], total_indexed: 0,
        error: e instanceof Error ? e.message : "Snov fetch failed" };
    }
  },
};

// ─────────────────────────────────────────────────────────────────
// SALESQL  (BYO key — paid plan)
// ─────────────────────────────────────────────────────────────────
const salesql: Provider = {
  name: "salesql",
  isEnabled() { return !!process.env.SALESQL_API_KEY; },
  async searchDomain(domain, { limit = 25 } = {}) {
    const key = process.env.SALESQL_API_KEY!;
    try {
      const res = await fetch(`https://api.salesql.com/v1/people/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ domain, limit }),
      });
      if (!res.ok) return { ok: false, provider: "salesql", people: [], total_indexed: 0,
        error: `SalesQL HTTP ${res.status}` };
      const json = await res.json();
      const people: RawPerson[] = (json?.data ?? json?.people ?? []).map((p: any) => ({
        first_name: p.first_name ?? "",
        last_name: p.last_name ?? "",
        email: p.email ?? "",
        title: p.title ?? null,
        linkedin_url: p.linkedin_url ?? null,
        confidence: p.email_confidence ?? null,
        company_name: p.company_name ?? domain,
        company_domain: domain,
        source_provider: "salesql",
        source_id: `salesql:${p.id ?? p.email}`,
      })).filter((p: RawPerson) => p.email);
      return { ok: true, provider: "salesql", people, total_indexed: people.length };
    } catch (e) {
      return { ok: false, provider: "salesql", people: [], total_indexed: 0,
        error: e instanceof Error ? e.message : "SalesQL fetch failed" };
    }
  },
};

// ─────────────────────────────────────────────────────────────────
// CONTACTOUT  (BYO key — paid plan)
// ─────────────────────────────────────────────────────────────────
const contactout: Provider = {
  name: "contactout",
  isEnabled() { return !!process.env.CONTACTOUT_API_KEY; },
  async searchDomain(domain, { limit = 25 } = {}) {
    const key = process.env.CONTACTOUT_API_KEY!;
    try {
      const res = await fetch(`https://api.contactout.com/v1/people/search`, {
        method: "POST",
        headers: { authorization: key, "Content-Type": "application/json" },
        body: JSON.stringify({ company_domain: domain, page: 1, results_per_page: limit }),
      });
      if (!res.ok) return { ok: false, provider: "contactout", people: [], total_indexed: 0,
        error: `ContactOut HTTP ${res.status}` };
      const json = await res.json();
      const profiles = json?.profiles ?? json?.data ?? [];
      const people: RawPerson[] = profiles.map((p: any) => ({
        first_name: p.first_name ?? (p.full_name ?? "").split(" ")[0] ?? "",
        last_name: p.last_name ?? (p.full_name ?? "").split(" ").slice(1).join(" "),
        email: p.email ?? p.personal_emails?.[0] ?? p.work_emails?.[0] ?? "",
        title: p.title ?? null,
        linkedin_url: p.linkedin_url ?? null,
        confidence: p.email_status === "verified" ? 90 : null,
        company_name: p.company_name ?? domain,
        company_domain: domain,
        source_provider: "contactout",
        source_id: `contactout:${p.linkedin_url ?? p.email}`,
      })).filter((p: RawPerson) => p.email);
      return { ok: true, provider: "contactout", people, total_indexed: people.length };
    } catch (e) {
      return { ok: false, provider: "contactout", people: [], total_indexed: 0,
        error: e instanceof Error ? e.message : "ContactOut fetch failed" };
    }
  },
};

// ─────────────────────────────────────────────────────────────────
// SKRAPP  (BYO key — paid plan)
// ─────────────────────────────────────────────────────────────────
const skrapp: Provider = {
  name: "skrapp",
  isEnabled() { return !!process.env.SKRAPP_API_KEY; },
  async searchDomain(domain, { limit = 25 } = {}) {
    const key = process.env.SKRAPP_API_KEY!;
    try {
      const url = new URL("https://api.skrapp.io/api/v3/company-list/find");
      url.searchParams.set("name", domain);
      url.searchParams.set("limit", String(limit));
      const res = await fetch(url, { headers: { "X-Access-Key": key } });
      if (!res.ok) return { ok: false, provider: "skrapp", people: [], total_indexed: 0,
        error: `Skrapp HTTP ${res.status}` };
      const json = await res.json();
      const emails = json?.emails ?? json?.data ?? [];
      const people: RawPerson[] = emails.map((e: any) => ({
        first_name: e.firstName ?? "",
        last_name: e.lastName ?? "",
        email: e.email,
        title: e.position ?? null,
        linkedin_url: null,
        confidence: e.qualityScore ?? null,
        company_name: e.companyName ?? domain,
        company_domain: domain,
        source_provider: "skrapp",
        source_id: `skrapp:${e.email}`,
      })).filter((p: RawPerson) => p.email);
      return { ok: true, provider: "skrapp", people, total_indexed: people.length };
    } catch (e) {
      return { ok: false, provider: "skrapp", people: [], total_indexed: 0,
        error: e instanceof Error ? e.message : "Skrapp fetch failed" };
    }
  },
};

// ─────────────────────────────────────────────────────────────────
// ROCKETREACH (BYO key — paid plan)
// ─────────────────────────────────────────────────────────────────
const rocketreach: Provider = {
  name: "rocketreach",
  isEnabled() { return !!process.env.ROCKETREACH_API_KEY; },
  async searchDomain(domain, { limit = 25 } = {}) {
    const key = process.env.ROCKETREACH_API_KEY!;
    try {
      const res = await fetch("https://api.rocketreach.co/v2/api/search", {
        method: "POST",
        headers: { "Api-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ query: { current_employer_domain: [domain] }, page_size: limit, start: 1 }),
      });
      if (!res.ok) return { ok: false, provider: "rocketreach", people: [], total_indexed: 0,
        error: `RocketReach HTTP ${res.status}` };
      const json = await res.json();
      const profiles = json?.profiles ?? [];
      const people: RawPerson[] = profiles
        .filter((p: any) => p.current_work_email || p.recommended_email || p.emails?.[0]?.email)
        .map((p: any) => ({
          first_name: p.first_name ?? "",
          last_name: p.last_name ?? "",
          email: p.current_work_email ?? p.recommended_email ?? p.emails?.[0]?.email ?? "",
          title: p.current_title ?? null,
          linkedin_url: p.linkedin_url ?? null,
          confidence: 80,
          company_name: p.current_employer ?? domain,
          company_domain: domain,
          source_provider: "rocketreach",
          source_id: `rocketreach:${p.id ?? p.email}`,
        }));
      return { ok: true, provider: "rocketreach", people, total_indexed: people.length };
    } catch (e) {
      return { ok: false, provider: "rocketreach", people: [], total_indexed: 0,
        error: e instanceof Error ? e.message : "RocketReach fetch failed" };
    }
  },
};

export function allProviders(): Provider[] {
  return [hunter, snov, salesql, contactout, skrapp, rocketreach];
}

export function enabledProviders(): Provider[] {
  return allProviders().filter(p => p.isEnabled());
}

/** Aggregate result merged across providers: same person from N sources collapsed,
 * with provider list preserved so the UI can show badges. */
export interface AggregatedPerson extends RawPerson {
  providers: string[];
}

/** Run every enabled provider for the given domain in parallel.
 * Dedupes by lowercased email. */
export async function searchDomainAllProviders(
  domain: string,
  opts: { limit?: number } = {}
): Promise<{
  domain: string;
  people: AggregatedPerson[];
  total_indexed: number;
  per_provider: { name: string; ok: boolean; count: number; error?: string }[];
}> {
  const providers = enabledProviders();
  const results = await Promise.all(providers.map(p => p.searchDomain(domain, opts)));

  const merged = new Map<string, AggregatedPerson>();
  let total = 0;
  for (const r of results) {
    total += r.total_indexed;
    for (const person of r.people) {
      const key = person.email.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        existing.providers.push(r.provider);
        // Prefer richer data: take title/linkedin if missing
        if (!existing.title && person.title) existing.title = person.title;
        if (!existing.linkedin_url && person.linkedin_url) existing.linkedin_url = person.linkedin_url;
        if (!existing.first_name && person.first_name) existing.first_name = person.first_name;
        if (!existing.last_name && person.last_name) existing.last_name = person.last_name;
        // Confidence: take max
        if ((person.confidence ?? 0) > (existing.confidence ?? 0)) {
          existing.confidence = person.confidence;
        }
      } else {
        merged.set(key, { ...person, providers: [r.provider] });
      }
    }
  }

  return {
    domain,
    people: Array.from(merged.values()),
    total_indexed: total,
    per_provider: results.map(r => ({
      name: r.provider,
      ok: r.ok,
      count: r.people.length,
      error: r.error,
    })),
  };
}
