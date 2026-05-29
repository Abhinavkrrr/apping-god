// One-shot: apply 20260527000001_bounces.sql against the live DB.
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
              "20260527000001_bounces.sql"), "utf8"
  );
  const c = new Client(POOLER);
  await c.connect();
  console.log("Connected. Applying bounces migration…");
  await c.query(sql);
  console.log("✓ Migration applied.");

  const { rows } = await c.query(`
    SELECT count(*) AS n FROM bounces
  `);
  console.log(`Bounces table now has ${rows[0].n} rows.`);

  await c.end();
})();
