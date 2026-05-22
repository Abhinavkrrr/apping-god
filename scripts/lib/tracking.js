// Tracking injection — adds open pixel + rewrites links through CF Worker.
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const BASE = (process.env.TRACKING_BASE_URL || "").replace(/\/$/, "");
const SENDER_ADDR = process.env.SENDER_PHYSICAL_ADDRESS
  || "IIT Bombay, Powai, Mumbai 400076, India";
const LOGO_URL = process.env.IIT_LOGO_URL || "";

function ensureBase() {
  if (!BASE) throw new Error("TRACKING_BASE_URL is not set in .env");
}

function pixelUrl(sendId) { ensureBase(); return `${BASE}/t/open/${sendId}.gif`; }
function clickUrl(sendId, target) { ensureBase(); return `${BASE}/t/click/${sendId}?u=${encodeURIComponent(target)}`; }
function unsubUrl(sendId) { ensureBase(); return `${BASE}/t/unsub/${sendId}`; }

/**
 * Convert plain-text body to HTML with:
 * - Newlines → <br>
 * - Bare URLs auto-linked
 * - All links wrapped through tracking redirect
 * - Trailing open pixel + unsubscribe footer
 */
function plainToTrackedHtml(plainBody, sendId) {
  const escaped = plainBody
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Markdown-style links FIRST: [text](url) → <a href="url">text</a>
  // (must come before auto-link so we don't double-wrap)
  const mdLinked = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text, url) => `<a href="${clickUrl(sendId, url)}" style="color:#0366d6;text-decoration:underline">${text}</a>`
  );

  // Auto-link any remaining bare URLs
  const linked = mdLinked.replace(
    /(?<!["'>])(https?:\/\/[^\s<>"]+)/g,
    (url) => `<a href="${clickUrl(sendId, url)}" style="color:#0366d6;text-decoration:underline">${url}</a>`
  );

  // Markdown-style bold: **word** → <strong>word</strong>
  const bolded = linked.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

  // Newlines → <br>
  const withBreaks = bolded.replace(/\n/g, "<br>\n");

  const logoBlock = LOGO_URL
    ? `<br><br><img src="${LOGO_URL}" alt="IIT Bombay" style="display:block;border:0;margin-top:8px;max-width:120px;height:auto" />`
    : "";

  // No unsubscribe footer (per user preference - personal outreach feel).
  const pixel = `<img src="${pixelUrl(sendId)}" width="1" height="1" alt="" style="display:block;border:0" />`;

  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${withBreaks}${logoBlock}${pixel}</div>`;
}

/** Plain-text version. Strips **bold** markers + converts [text](url) → "text (url)" for readability. */
function plainWithFooter(plainBody, _sendId) {
  return plainBody
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1');
}

module.exports = { pixelUrl, clickUrl, unsubUrl, plainToTrackedHtml, plainWithFooter };
