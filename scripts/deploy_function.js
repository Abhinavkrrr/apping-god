// Deploys a Supabase Edge Function via the Management API (no CLI needed).
// Usage: node scripts/deploy_function.js <function_slug>
//        e.g., node scripts/deploy_function.js send-worker
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: node scripts/deploy_function.js <slug>");
  process.exit(1);
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!TOKEN || !REF) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF in .env");
  process.exit(1);
}

const fnDir = path.join(__dirname, "..", "backend", "supabase", "functions", slug);
const entrypoint = path.join(fnDir, "index.ts");
if (!fs.existsSync(entrypoint)) {
  console.error(`Not found: ${entrypoint}`);
  process.exit(1);
}

const fileContent = fs.readFileSync(entrypoint, "utf8");
console.log(`Deploying ${slug} (${fileContent.length} bytes)...`);

(async () => {
  // Multipart form for the deploy endpoint.
  // The new Supabase Edge Function deploy API uses POST /functions/deploy
  // with multipart body containing { metadata: JSON, file: source }
  const boundary = "----appingboundary" + Math.random().toString(36).slice(2);

  const metadata = {
    name: slug,
    entrypoint_path: "index.ts",
    static_patterns: [],
    verify_jwt: true,
  };

  const parts = [];
  // metadata part
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="metadata"\r\n`);
  parts.push(`Content-Type: application/json\r\n\r\n`);
  parts.push(JSON.stringify(metadata) + "\r\n");
  // file part
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="file"; filename="index.ts"\r\n`);
  parts.push(`Content-Type: application/typescript\r\n\r\n`);
  parts.push(fileContent + "\r\n");
  parts.push(`--${boundary}--\r\n`);

  const body = parts.join("");

  const url = `https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${encodeURIComponent(slug)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text);

  if (res.ok) {
    console.log(`\n✓ Deployed.`);
    console.log(`Invoke at: https://${REF}.functions.supabase.co/${slug}`);
  } else {
    process.exit(1);
  }
})();
