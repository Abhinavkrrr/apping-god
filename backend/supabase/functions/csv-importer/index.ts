// CSV importer — invoked by dashboard upload.
// Parses CSV, upserts companies + contacts, triggers email verification.
//
// Phase 1: accepts JSON array of contact rows directly (skip file parse).
// Phase 3: adds full file upload + column mapping wizard.

import { admin, corsHeaders } from "../_shared/supabase.ts";

interface ContactRow {
  name: string;
  email: string;
  company: string;
  campaign?: string;
  company_brief?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const rows: ContactRow[] = body?.rows ?? [];

  if (!Array.isArray(rows) || rows.length === 0) {
    return new Response(JSON.stringify({ error: "rows[] required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = admin();
  let companies = 0;
  let contacts = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.email || !row.name || !row.company) continue;

    // Upsert company
    const { data: company, error: cErr } = await sb
      .from("companies")
      .upsert(
        { name: row.company, brief_one_line: row.company_brief ?? null },
        { onConflict: "name", ignoreDuplicates: false }
      )
      .select("id")
      .single();

    if (cErr) {
      errors.push(`company ${row.company}: ${cErr.message}`);
      continue;
    }
    companies++;

    // Split name → first / last
    const parts = row.name.trim().split(/\s+/);
    const first_name = parts[0];
    const last_name = parts.slice(1).join(" ") || null;

    // Upsert contact
    const { error: pErr } = await sb.from("contacts").upsert(
      {
        first_name,
        last_name,
        email: row.email.toLowerCase().trim(),
        company_id: company.id,
        source: "csv",
        custom_fields: { campaign_tag: row.campaign ?? null },
      },
      { onConflict: "email", ignoreDuplicates: false }
    );

    if (pErr) {
      errors.push(`contact ${row.email}: ${pErr.message}`);
      continue;
    }
    contacts++;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      imported_companies: companies,
      imported_contacts: contacts,
      errors: errors.slice(0, 10),
      error_count: errors.length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
