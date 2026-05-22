// Applies the initial schema migration to the remote Supabase Postgres.
// Tries direct host first, then pooler in common regions.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const { Client } = require("pg");

const migrationFile = process.argv[2]
  || path.join(__dirname, "..", "backend", "supabase", "migrations", "20260523000001_initial_schema.sql");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const dbPassword = process.env.SUPABASE_DB_PASSWORD;
if (!supabaseUrl || !dbPassword) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_DB_PASSWORD in .env");
  process.exit(1);
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];

// Project lives on aws-1-ap-southeast-1 (Singapore). Probe other regions as fallback.
const REGIONS = [
  "ap-southeast-1",  // discovered match
  "ap-south-1",
  "us-east-1", "us-east-2", "us-west-1",
  "eu-west-1", "eu-west-2", "eu-central-1",
  "ap-southeast-2", "ap-northeast-1", "ap-northeast-2",
  "sa-east-1", "ca-central-1",
];

const candidates = [
  // Direct (IPv6-only on most projects; usually fails on home networks)
  { label: "direct (db.*.supabase.co)", host: `db.${projectRef}.supabase.co`, port: 5432, user: "postgres" },
  // Both aws-1 (newer) and aws-0 (older) pooler prefixes, txn + session ports
  ...REGIONS.flatMap(r => ([
    { label: `aws-1 txn-pooler ${r}`,     host: `aws-1-${r}.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
    { label: `aws-1 session-pooler ${r}`, host: `aws-1-${r}.pooler.supabase.com`, port: 5432, user: `postgres.${projectRef}` },
    { label: `aws-0 txn-pooler ${r}`,     host: `aws-0-${r}.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
    { label: `aws-0 session-pooler ${r}`, host: `aws-0-${r}.pooler.supabase.com`, port: 5432, user: `postgres.${projectRef}` },
  ])),
];

async function tryConnect(cfg) {
  // Pre-check DNS to skip fast
  try {
    await dns.lookup(cfg.host);
  } catch {
    return null;
  }
  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: dbPassword,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    statement_timeout: 0,
  });
  try {
    await client.connect();
    return client;
  } catch (e) {
    try { await client.end(); } catch {}
    return null;
  }
}

(async () => {
  console.log(`Project ref: ${projectRef}`);
  console.log(`Probing ${candidates.length} connection candidates...\n`);

  let client = null;
  let chosen = null;
  for (const cfg of candidates) {
    process.stdout.write(`  trying ${cfg.label} ... `);
    const c = await tryConnect(cfg);
    if (c) {
      console.log("OK");
      client = c;
      chosen = cfg;
      break;
    } else {
      console.log("fail");
    }
  }

  if (!client) {
    console.error("\n✗ Could not connect to Supabase Postgres via any candidate.");
    console.error("  Possible fixes:");
    console.error("  1. Verify SUPABASE_DB_PASSWORD in .env is correct.");
    console.error("  2. Apply the migration manually via Supabase Dashboard → SQL Editor.");
    console.error("     File:", migrationFile);
    process.exit(1);
  }

  try {
    console.log(`\nConnected via: ${chosen.label} (${chosen.host}:${chosen.port})`);

    const sql = fs.readFileSync(migrationFile, "utf8");
    console.log(`Applying ${path.basename(migrationFile)} (${sql.length} bytes)...`);

    await client.query(sql);
    console.log("✓ Migration applied successfully.");

    const r = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
    );
    console.log("\nTables in public schema:");
    r.rows.forEach(row => console.log("  -", row.table_name));

    const c2 = await client.query("SELECT name, status FROM public.campaigns ORDER BY name");
    console.log("\nSeed campaigns:");
    c2.rows.forEach(row => console.log("  -", row.name, "(", row.status, ")"));
  } catch (e) {
    console.error("✗ Migration failed:", e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
