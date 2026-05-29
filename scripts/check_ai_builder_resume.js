// Diagnose + fix: confirm whether the AI Builder Internship campaign has
// a resume attached. If not, copy whatever resume Outreach uses
// (assuming Outreach is your working "real attachment" baseline).

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

const POOLER = {
  host: "aws-1-ap-southeast-1.pooler.supabase.com", port: 6543,
  user: "postgres.ouzfrefnhlxhpeyufllt",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
};

(async () => {
  const c = new Client(POOLER);
  await c.connect();
  console.log("Connected.\n");

  // 1. Inspect every campaign's resume_id + the resumes table
  const { rows: campaigns } = await c.query(`
    SELECT ca.name, ca.resume_id, r.label, r.is_default, r.storage_path
    FROM campaigns ca
    LEFT JOIN resumes r ON r.id = ca.resume_id
    WHERE ca.status = 'active'
    ORDER BY ca.name
  `);
  console.log("── Active campaigns + their resumes ──");
  console.table(campaigns);

  const { rows: resumes } = await c.query(`
    SELECT id, label, is_default, uploaded_at FROM resumes ORDER BY is_default DESC, uploaded_at DESC
  `);
  console.log("\n── Available resumes ──");
  console.table(resumes);

  // 2. Diagnosis
  const ai = campaigns.find(c => c.name === 'AI Builder Internship');
  const outreach = campaigns.find(c => c.name === 'Outreach');

  if (!ai) { console.error("✗ AI Builder Internship campaign not found."); process.exit(1); }

  if (ai.resume_id) {
    console.log(`\n✓ AI Builder Internship ALREADY has a resume attached: ${ai.label} (${ai.resume_id})`);
    console.log("  No fix needed.");
    await c.end();
    return;
  }

  console.log(`\n✗ AI Builder Internship has NO resume attached. CV would NOT be sent with drafts.`);

  // 3. Pick the right resume to attach: prefer Outreach's (proven working),
  //    fall back to whatever is_default=true, fall back to most recent.
  let targetResumeId = null;
  let source = null;
  if (outreach?.resume_id) {
    targetResumeId = outreach.resume_id;
    source = `Outreach campaign uses '${outreach.label}'`;
  } else if (resumes.find(r => r.is_default)) {
    const def = resumes.find(r => r.is_default);
    targetResumeId = def.id;
    source = `is_default=true: '${def.label}'`;
  } else if (resumes.length > 0) {
    targetResumeId = resumes[0].id;
    source = `most recent: '${resumes[0].label}'`;
  } else {
    console.error("✗ No resumes exist in the resumes table at all. Upload one via /resumes first.");
    process.exit(1);
  }
  console.log(`  Fix: attach '${source}' → AI Builder Internship`);

  // 4. UPDATE the campaign
  await c.query("UPDATE campaigns SET resume_id = $1 WHERE name = 'AI Builder Internship'", [targetResumeId]);
  console.log(`  ✓ campaigns.resume_id updated.`);

  // 5. Backfill any pending drafts whose resume_id is NULL
  const { data: bd, rowCount } = await c.query(`
    UPDATE sends SET resume_id = $1
    WHERE campaign_id = (SELECT id FROM campaigns WHERE name = 'AI Builder Internship')
      AND status = 'pending_approval'
      AND resume_id IS NULL
    RETURNING id
  `, [targetResumeId]);
  console.log(`  ✓ Backfilled resume_id on ${rowCount} pending draft(s).`);

  // 6. Re-verify
  const { rows: after } = await c.query(`
    SELECT ca.name, r.label AS resume_attached
    FROM campaigns ca LEFT JOIN resumes r ON r.id = ca.resume_id
    WHERE ca.name = 'AI Builder Internship'
  `);
  console.log(`\n── After fix ──`);
  console.table(after);

  await c.end();
})();
