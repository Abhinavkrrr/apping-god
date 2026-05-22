// Uploads Resume_AbhinavKumar_IITB.pdf to Supabase Storage and inserts
// a row in the `resumes` table, marked as default.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const RESUME_PATH = process.argv[2] || "F:\\god\\Resume_AbhinavKumar_IITB.pdf";
const BUCKET = "resumes";
const LABEL = "Abhinav Kumar — IIT Bombay (default)";

(async () => {
  if (!fs.existsSync(RESUME_PATH)) {
    console.error(`File not found: ${RESUME_PATH}`);
    process.exit(1);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Ensure bucket exists
  console.log(`Ensuring bucket "${BUCKET}" exists...`);
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets.find(b => b.name === BUCKET)) {
    const { error } = await sb.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024, // 10 MB
    });
    if (error) { console.error("createBucket:", error.message); process.exit(1); }
    console.log("  ✓ Created bucket.");
  } else {
    console.log("  ✓ Bucket already exists.");
  }

  // Upload file
  const fileName = `default-${Date.now()}-${path.basename(RESUME_PATH)}`;
  const buffer = fs.readFileSync(RESUME_PATH);
  console.log(`Uploading ${path.basename(RESUME_PATH)} (${buffer.length} bytes)...`);
  const { data: up, error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(fileName, buffer, { contentType: "application/pdf", upsert: false });
  if (upErr) { console.error("upload:", upErr.message); process.exit(1); }
  console.log(`  ✓ Uploaded to ${BUCKET}/${up.path}`);

  // Clear existing defaults, insert new row marked default
  await sb.from("resumes").update({ is_default: false }).eq("is_default", true);
  const { data: row, error: rowErr } = await sb.from("resumes").insert({
    label: LABEL,
    storage_path: up.path,
    is_default: true,
  }).select().single();
  if (rowErr) { console.error("insert resume row:", rowErr.message); process.exit(1); }
  console.log(`  ✓ Inserted resumes row: ${row.id}`);

  // Backfill: set this resume as the default for all campaigns
  await sb.from("campaigns").update({ resume_id: row.id }).is("resume_id", null);
  console.log("  ✓ Linked to all campaigns without an assigned resume.");

  console.log("\nDone. Default resume is now ready for sends.");
})();
