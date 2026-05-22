// Tracking injection — adds open pixel + rewrites links through CF Worker.
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const BASE = (process.env.TRACKING_BASE_URL || "").replace(/\/$/, "");
const SENDER_ADDR = process.env.SENDER_PHYSICAL_ADDRESS
  || "IIT Bombay, Powai, Mumbai 400076, India";

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

  // Auto-link bare URLs
  const linked = escaped.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    (url) => `<a href="${clickUrl(sendId, url)}" style="color:#0366d6;text-decoration:underline">${url}</a>`
  );

  // Markdown-style bold: **word** → <strong>word</strong>
  const bolded = linked.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

  // Newlines → <br>
  const withBreaks = bolded.replace(/\n/g, "<br>\n");

  const footer = `<br><br>
<p style="font-size:11px;color:#9ca3af;line-height:1.4;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px">
${SENDER_ADDR}<br>
<a href="${unsubUrl(sendId)}" style="color:#9ca3af;text-decoration:underline">Unsubscribe</a>
</p>`;

  const pixel = `<img src="${pixelUrl(sendId)}" width="1" height="1" alt="" style="display:block;border:0" />`;

  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${withBreaks}${footer}${pixel}</div>`;
}

/** Plain-text version with unsubscribe footer. Strips **bold** markers so text reads naturally. */
function plainWithFooter(plainBody, sendId) {
  const stripped = plainBody.replace(/\*\*([^*\n]+?)\*\*/g, '$1');
  return `${stripped}\n\n---\n${SENDER_ADDR}\nUnsubscribe: ${unsubUrl(sendId)}\n`;
}

module.exports = { pixelUrl, clickUrl, unsubUrl, plainToTrackedHtml, plainWithFooter };
