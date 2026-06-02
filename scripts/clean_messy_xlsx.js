// Transforms F:\god\New folder\2.xlsx (wide-format: 1 row per company,
// 1-12 email columns) into a clean long-format xlsx with the exact
// columns the dashboard importer expects: Name | Email | Company.
//
// Names are derived from each email's local-part (everything before @),
// stripped of digits/underscores/dots, and Title Cased.
// Company names: commas replaced with spaces (e.g. "Yellow,Messenger"
// → "Yellow Messenger") and trimmed.
//
// Personal-domain emails (gmail, yahoo, hotmail, outlook, etc.) are
// kept — they're often the founder's personal address linked to the
// company, and the importer doesn't care about the domain.
//
// Output: F:\god\New folder\2_cleaned.xlsx (plus _cleaned.csv for the
// belt-and-suspenders).

const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const IN  = "F:/god/New folder/2.xlsx";
const OUT_XLSX = "F:/god/New folder/2_cleaned.xlsx";
const OUT_CSV  = "F:/god/New folder/2_cleaned.csv";

// ─── Helpers ──────────────────────────────────────────────────────

function cleanCompany(raw) {
  return (raw || "")
    .replace(/,/g, " ")            // "Yellow,Messenger" → "Yellow Messenger"
    .replace(/\s+/g, " ")          // collapse repeated spaces
    .trim();
}

function deriveName(email) {
  const local = (email.split("@")[0] || "").toLowerCase();
  // Split on common separators
  const parts = local
    .split(/[._\-+]+/)
    .map(p => p.replace(/\d+/g, ""))   // strip digits ("singh0511" → "singh")
    .filter(p => p.length >= 2);       // drop noise tokens like "k", "_"
  if (parts.length === 0) {
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  // Title-case each part
  const titled = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1));
  // Use up to first 2 parts (first_name + last_name); the rest tend to be
  // domain hints or middle initials
  return titled.slice(0, 2).join(" ");
}

function isLikelyEmail(s) {
  if (!s) return false;
  const trimmed = s.trim().toLowerCase();
  // Simple but practical email check; we don't need RFC-perfect
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed);
}

// ─── Main ─────────────────────────────────────────────────────────

(async () => {
  console.log(`Reading ${IN}…`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(IN);
  const ws = wb.worksheets[0];

  const rows = [];                  // {Name, Email, Company}
  const seenEmails = new Set();     // dedupe — keep first occurrence
  let skippedInvalid = 0;
  let skippedDupes = 0;
  let companiesWithData = 0;
  const emailsByCompany = new Map();

  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const companyRaw = row.getCell(1).text || "";
    const company = cleanCompany(companyRaw);
    if (!company) continue;          // skip header / blank rows

    let foundForCompany = 0;
    for (let c = 2; c <= ws.columnCount; c++) {
      const cellText = (row.getCell(c).text || "").trim();
      if (!cellText) continue;

      if (!isLikelyEmail(cellText)) {
        skippedInvalid++;
        continue;
      }
      const email = cellText.toLowerCase();

      if (seenEmails.has(email)) {
        skippedDupes++;
        continue;
      }
      seenEmails.add(email);

      rows.push({ Name: deriveName(email), Email: email, Company: company });
      foundForCompany++;
    }
    if (foundForCompany > 0) {
      companiesWithData++;
      emailsByCompany.set(company, (emailsByCompany.get(company) ?? 0) + foundForCompany);
    }
  }

  // ─── Summary ──────────────────────────────────────────────────
  console.log(`\n── Cleanup summary ──`);
  console.log(`  Total rows extracted:  ${rows.length}`);
  console.log(`  Companies covered:     ${companiesWithData}`);
  console.log(`  Duplicate emails:      ${skippedDupes} (skipped)`);
  console.log(`  Invalid/non-email:     ${skippedInvalid} (skipped)`);

  // Top-10 companies by email count, for sanity-checking
  const topCompanies = [...emailsByCompany.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`\n── Top 10 companies by # emails ──`);
  for (const [name, n] of topCompanies) console.log(`  ${n.toString().padStart(3)} · ${name}`);

  // ─── Write CSV ─────────────────────────────────────────────────
  const csvLines = ["Name,Email,Company"];
  for (const r of rows) {
    const safe = (v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    csvLines.push([safe(r.Name), safe(r.Email), safe(r.Company)].join(","));
  }
  fs.writeFileSync(OUT_CSV, csvLines.join("\n"), "utf8");
  console.log(`\n✓ Wrote ${rows.length} rows → ${OUT_CSV}`);

  // ─── Write XLSX ────────────────────────────────────────────────
  const out = new ExcelJS.Workbook();
  out.creator = "DingDing — clean_messy_xlsx";
  const sheet = out.addWorksheet("Cleaned Contacts", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Name",    key: "name",    width: 28 },
    { header: "Email",   key: "email",   width: 40 },
    { header: "Company", key: "company", width: 28 },
  ];
  sheet.getRow(1).eachCell(c => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  });
  sheet.getRow(1).height = 22;
  for (const r of rows) {
    const added = sheet.addRow({ name: r.Name, email: r.Email, company: r.Company });
    added.getCell("email").value = { text: r.Email, hyperlink: `mailto:${r.Email}` };
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 3 } };
  await out.xlsx.writeFile(OUT_XLSX);
  console.log(`✓ Wrote ${rows.length} rows → ${OUT_XLSX}`);

  console.log(`\nNext step:`);
  console.log(`  Open the dashboard /contacts → Import CSV / Excel →`);
  console.log(`  pick: ${OUT_XLSX}`);
  console.log(`  Batch label: "PE Round 2" (or whatever you want)`);
})();
