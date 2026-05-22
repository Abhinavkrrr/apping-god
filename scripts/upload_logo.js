// Uploads the IIT Bombay logo PNG to Supabase Storage's "public-assets"
// bucket (publicly accessible URL), prints the URL for use in email signature.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const LOGO_PATH = process.argv[2] || "F:\\god\\logo (1).png";
const BUCKET = "public-assets";
const FILE_NAME = "iit-bombay-logo.png";

(async () => {
  if (!fs.existsSync(LOGO_PATH)) {
    console.error(`Not found: ${LOGO_PATH}`);
    process.exit(1);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // Ensure public bucket exists
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets.find(b => b.name === BUCKET)) {
    const { error } = await sb.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/svg+xml"],
    });
    if (error) { console.error("createBucket:", error.message); process.exit(1); }
    console.log(`✓ Created public bucket: ${BUCKET}`);
  }

  const buffer = fs.readFileSync(LOGO_PATH);
  console.log(`Uploading ${path.basename(LOGO_PATH)} (${buffer.length} bytes)...`);

  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(FILE_NAME, buffer, {
      contentType: "image/png",
      upsert: true, // overwrite if exists
    });
  if (upErr) { console.error("upload:", upErr.message); process.exit(1); }

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(FILE_NAME);
  console.log(`\n✓ Logo public URL:\n  ${pub.publicUrl}\n`);
  console.log("Set this in .env as IIT_LOGO_URL.");
})();
