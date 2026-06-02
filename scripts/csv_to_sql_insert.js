// Reads a cleaned CSV (Name,Email,Company columns) and emits a SQL
// file you can paste into Supabase SQL Editor to bulk-insert all
// contacts in one shot — bypassing the dashboard entirely. Use this
// when the dashboard import fails silently and you just want the
// contacts in.
//
// Usage:
//   node scripts/csv_to_sql_insert.js "path/to/cleaned.csv" "Batch Name" > out.sql
//
// Then: paste the contents of out.sql into Supabase SQL Editor and Run.

const fs = require("fs");
const path = require("path");

const csvPath  = process.argv[2];
const batchName = (process.argv[3] || "Bulk Imported").replace(/'/g, "''");

if (!csvPath) {
  console.error("Usage: node scripts/csv_to_sql_insert.js <cleaned.csv> [batchName]");
  process.exit(1);
}

function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i+1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch === "\r") {}
      else cell += ch;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function sqlQuote(v) {
  if (v == null || v === "") return "NULL";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const data = parseCsv(fs.readFileSync(path.resolve(csvPath), "utf8"));
const [header, ...body] = data;

const idx = (n) => {
  const lower = n.toLowerCase();
  const i = header.findIndex(h => h.trim().toLowerCase() === lower);
  return i;
};
const iName  = idx("name");
const iEmail = idx("email");
const iCo    = idx("company");
if (iName < 0 || iEmail < 0) {
  console.error(`CSV must have Name and Email columns. Found: ${header.join(", ")}`);
  process.exit(1);
}

const rows = body
  .filter(r => r[iEmail] && r[iEmail].includes("@"))
  .map(r => {
    const fullName = (r[iName] || "").trim();
    const parts = fullName.split(/\s+/);
    return {
      first_name: parts[0] || "",
      last_name: parts.slice(1).join(" ") || null,
      email: r[iEmail].trim().toLowerCase(),
      company: (r[iCo] || "").trim() || null,
    };
  });

// Dedupe by email
const seen = new Set();
const unique = rows.filter(r => {
  if (seen.has(r.email)) return false;
  seen.add(r.email); return true;
});

console.log("-- Bulk import via SQL — paste into Supabase SQL Editor & Run.");
console.log(`-- Source: ${csvPath}`);
console.log(`-- Rows: ${unique.length} unique contacts under batch "${batchName}"`);
console.log("--");
console.log("-- This:");
console.log("--   1. Creates the import_batches row");
console.log("--   2. Inserts (or no-ops) any new companies via ON CONFLICT");
console.log("--   3. Inserts (or updates) the contacts via ON CONFLICT");
console.log("--   4. Re-tags every imported email to this batch");
console.log("--   5. Reports the final row count");
console.log("--");
console.log("BEGIN;");
console.log("");
console.log("DO $$");
console.log("DECLARE");
console.log("  v_batch_id uuid;");
console.log("  v_imported int := 0;");
console.log("BEGIN");
console.log(`  -- Create the batch`);
console.log(`  INSERT INTO import_batches (name, source, file_name)`);
console.log(`  VALUES ('${batchName}', 'csv', ${sqlQuote(path.basename(csvPath))})`);
console.log(`  RETURNING id INTO v_batch_id;`);
console.log("");

// 2. Insert unique companies — companies.name has no UNIQUE constraint
// so we can't use ON CONFLICT. Use INSERT...SELECT...WHERE NOT EXISTS
// with a case-insensitive existence check instead.
const uniqueCompanies = [...new Set(unique.map(r => r.company).filter(Boolean))];
console.log(`  -- Insert ${uniqueCompanies.length} companies (skip if name already exists, case-insensitive)`);
if (uniqueCompanies.length > 0) {
  const chunkSize = 200;
  for (let i = 0; i < uniqueCompanies.length; i += chunkSize) {
    const chunk = uniqueCompanies.slice(i, i + chunkSize);
    const values = chunk.map(c => `(${sqlQuote(c)})`).join(",\n    ");
    console.log(`  INSERT INTO companies (name)`);
    console.log(`  SELECT v.name FROM (VALUES`);
    console.log(`    ${values}`);
    console.log(`  ) AS v(name)`);
    console.log(`  WHERE NOT EXISTS (`);
    console.log(`    SELECT 1 FROM companies c WHERE LOWER(c.name) = LOWER(v.name)`);
    console.log(`  );`);
  }
}
console.log("");

// 3. Bulk insert contacts via VALUES + a join on companies for company_id lookup
console.log(`  -- Bulk insert ${unique.length} contacts (re-tag email duplicates to this batch)`);
console.log("  INSERT INTO contacts (first_name, last_name, email, company_id, import_batch_id, source)");
console.log("  SELECT v.first_name, v.last_name, v.email, c.id, v_batch_id, 'sql-bulk-import'");
console.log("  FROM (VALUES");

const chunkSize2 = 500;
for (let i = 0; i < unique.length; i += chunkSize2) {
  const chunk = unique.slice(i, i + chunkSize2);
  const rowSQL = chunk.map((r, j) => {
    const isLast = (i + j === unique.length - 1);
    return `    (${sqlQuote(r.first_name)}, ${sqlQuote(r.last_name)}, ${sqlQuote(r.email)}, ${sqlQuote(r.company)})${isLast ? "" : ","}`;
  }).join("\n");
  console.log(rowSQL);
}

console.log("  ) AS v(first_name, last_name, email, company_name)");
console.log("  LEFT JOIN companies c ON LOWER(c.name) = LOWER(v.company_name)");
console.log("  ON CONFLICT (email) DO UPDATE SET");
console.log("    first_name = EXCLUDED.first_name,");
console.log("    last_name = EXCLUDED.last_name,");
console.log("    company_id = COALESCE(EXCLUDED.company_id, contacts.company_id),");
console.log("    import_batch_id = EXCLUDED.import_batch_id;");
console.log("");
console.log("  -- Tell PostgREST to refresh schema (harmless if already fresh)");
console.log("  NOTIFY pgrst, 'reload schema';");
console.log("");
console.log("  -- Report");
console.log("  SELECT count(*) INTO v_imported FROM contacts WHERE import_batch_id = v_batch_id;");
console.log("  RAISE NOTICE '✓ Imported % contacts under batch ''%''', v_imported, '" + batchName + "';");
console.log("END $$;");
console.log("");
console.log("COMMIT;");
console.log("");
console.log("-- Verify:");
console.log(`SELECT b.name, b.contact_count, count(c.id) AS actual_contacts`);
console.log(`FROM import_batches b LEFT JOIN contacts c ON c.import_batch_id = b.id`);
console.log(`WHERE b.name = '${batchName}'`);
console.log(`GROUP BY b.id, b.name, b.contact_count`);
console.log(`ORDER BY b.created_at DESC LIMIT 5;`);

// Stats to stderr so they don't end up in the SQL output
process.stderr.write(`\n── Generated SQL for ${unique.length} contacts × ${uniqueCompanies.length} companies → batch "${batchName}"\n`);
process.stderr.write(`── Pipe this to a .sql file: node scripts/csv_to_sql_insert.js "${csvPath}" "${batchName}" > import.sql\n`);
