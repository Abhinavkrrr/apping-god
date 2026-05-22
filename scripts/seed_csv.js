// Loads the seed CSV (F:\god\Apping Database - recipients.csv) into Supabase.
// Upserts companies + contacts. Tags each contact with its campaign label.
//
// Usage:
//   node scripts/seed_csv.js [path/to/csv]

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const csvPath = process.argv[2] || "F:\\god\\Apping Database - recipients.csv";
const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com",
  port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
};

// Minimal CSV parser handling quoted fields with commas inside.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

(async () => {
  console.log(`Reading ${csvPath}...`);
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCSV(raw);
  const header = rows.shift().map(h => h.trim());
  console.log(`Columns: ${header.join(", ")}`);
  console.log(`Data rows: ${rows.length}`);

  const idx = {
    name: header.indexOf("name"),
    email: header.indexOf("email"),
    company: header.indexOf("company"),
    campaign: header.indexOf("campaign"),
    company_brief: header.indexOf("company_brief"),
  };

  // Group by company
  const companyMap = new Map(); // company name → brief
  const contacts = [];
  for (const r of rows) {
    const name = (r[idx.name] || "").trim();
    const email = (r[idx.email] || "").trim().toLowerCase();
    const company = (r[idx.company] || "").trim();
    const campaign = (r[idx.campaign] || "").trim();
    const brief = (r[idx.company_brief] || "").trim();
    if (!name || !email || !company) continue;
    if (!companyMap.has(company) || (brief && !companyMap.get(company))) {
      companyMap.set(company, brief);
    }
    const parts = name.split(/\s+/);
    contacts.push({
      first_name: parts[0],
      last_name: parts.slice(1).join(" ") || null,
      email,
      company,
      campaign,
    });
  }
  console.log(`Distinct companies: ${companyMap.size}`);
  console.log(`Distinct contacts: ${contacts.length}`);

  const c = new Client(POOLER);
  await c.connect();
  console.log("Connected to Supabase.");

  // Insert companies first
  let cInserted = 0;
  for (const [name, brief] of companyMap) {
    await c.query(
      `INSERT INTO public.companies (name, brief_one_line)
       VALUES ($1, $2)
       ON CONFLICT ((lower(name))) DO UPDATE SET brief_one_line = COALESCE(EXCLUDED.brief_one_line, public.companies.brief_one_line)`,
      [name, brief || null]
    );
    cInserted++;
  }
  console.log(`✓ Upserted ${cInserted} companies.`);

  // Build company name → id map
  const companyIdMap = new Map();
  const cRes = await c.query("SELECT id, name FROM public.companies");
  for (const row of cRes.rows) companyIdMap.set(row.name, row.id);

  // Insert contacts
  let pInserted = 0;
  let pSkipped = 0;
  for (const p of contacts) {
    const companyId = companyIdMap.get(p.company);
    if (!companyId) { pSkipped++; continue; }
    try {
      await c.query(
        `INSERT INTO public.contacts
           (first_name, last_name, email, company_id, source, custom_fields)
         VALUES ($1, $2, $3, $4, 'csv-seed', $5::jsonb)
         ON CONFLICT (email) DO UPDATE
           SET first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               company_id = EXCLUDED.company_id,
               custom_fields = EXCLUDED.custom_fields`,
        [p.first_name, p.last_name, p.email, companyId, JSON.stringify({ campaign_tag: p.campaign })]
      );
      pInserted++;
    } catch (e) {
      pSkipped++;
      if (pSkipped < 5) console.warn(`  skipped ${p.email}: ${e.message}`);
    }
  }
  console.log(`✓ Upserted ${pInserted} contacts (skipped ${pSkipped}).`);

  // Final counts
  const totals = await c.query(
    `SELECT
       (SELECT count(*) FROM companies) AS companies,
       (SELECT count(*) FROM contacts) AS contacts,
       (SELECT count(*) FROM campaigns) AS campaigns`
  );
  console.log("\nDatabase totals:", totals.rows[0]);

  await c.end();
})();
