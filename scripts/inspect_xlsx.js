// Inspect an xlsx file: find the first non-empty row + dump everything below it.
// Usage: node scripts/inspect_xlsx.js "path/to/file.xlsx" [maxRows]

const ExcelJS = require("exceljs");
const path = require("path");

const filePath = process.argv[2];
const maxRows = parseInt(process.argv[3] || "20", 10);

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(filePath));

  console.log(`File: ${filePath}`);
  console.log(`Sheets: ${wb.worksheets.map(w => w.name).join(", ")}\n`);

  for (const ws of wb.worksheets) {
    console.log(`─── Sheet: "${ws.name}" (${ws.rowCount} rows × ${ws.columnCount} cols) ───\n`);

    // Find the first row that has any non-empty cell
    let firstDataRow = 1;
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      let hasData = false;
      for (let c = 1; c <= ws.columnCount; c++) {
        if (row.getCell(c).text && row.getCell(c).text.trim()) {
          hasData = true;
          break;
        }
      }
      if (hasData) { firstDataRow = r; break; }
    }
    console.log(`First non-empty row: ${firstDataRow}`);

    // Count total non-empty rows
    let nonEmptyCount = 0;
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= ws.columnCount; c++) {
        if (row.getCell(c).text && row.getCell(c).text.trim()) { nonEmptyCount++; break; }
      }
    }
    console.log(`Non-empty rows: ${nonEmptyCount}\n`);

    // Print first maxRows starting at first non-empty row
    const last = Math.min(firstDataRow + maxRows - 1, ws.rowCount);
    for (let r = firstDataRow; r <= last; r++) {
      const row = ws.getRow(r);
      const cells = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const text = row.getCell(c).text || "";
        cells.push(text.trim() || "·");
      }
      console.log(`R${String(r).padStart(3)} | ${cells.join(" | ")}`);
    }
  }
})();
