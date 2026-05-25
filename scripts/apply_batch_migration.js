// One-shot: apply 20260525000002_import_batches.sql against the live DB.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com", port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
};

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "backend", "supabase", "migrations",
              "20260525000002_import_batches.sql"),
    "utf8"
  );
  const c = new Client(POOLER);
  await c.connect();
  console.log("Connected. Applying migration…");
  await c.query(sql);
  console.log("✓ Migration applied.");

  const { rows } = await c.query(`
    SELECT name, source, contact_count, created_at
    FROM import_batches ORDER BY created_at DESC
  `);
  console.log("\nBatches now:");
  console.table(rows);

  await c.end();
})();
