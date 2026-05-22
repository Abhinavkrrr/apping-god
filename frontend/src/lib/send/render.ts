// Server-side rendering helpers — mirrors scripts/lib/tracking.js + render.js
import Mustache from "mustache";

Mustache.escape = (t: string) => t;

const TRACKING_BASE = (process.env.TRACKING_BASE_URL ?? "").replace(/\/$/, "");
const SENDER_ADDR = process.env.SENDER_PHYSICAL_ADDRESS
  ?? "IIT Bombay, Powai, Mumbai 400076, India";
const LOGO_URL = process.env.IIT_LOGO_URL ?? "";

export function render(template: string, ctx: Record<string, string>): string {
  return Mustache.render(template ?? "", ctx);
}

export function buildContext(
  contact: { first_name: string; last_name?: string | null; email: string; title?: string | null },
  company: { name?: string | null; domain?: string | null; brief_one_line?: string | null } | null,
  extras: Record<string, string> = {}
): Record<string, string> {
  return {
    first_name: contact.first_name ?? "",
    last_name: contact.last_name ?? "",
    full_name: [contact.first_name, contact.last_name].filter(Boolean).join(" "),
    email: contact.email,
    title: contact.title ?? "",
    company: company?.name ?? "",
    company_domain: company?.domain ?? "",
    company_brief_one_line: extras.company_brief_one_line ?? company?.brief_one_line ?? "",
    ...extras,
  };
}

function pixelUrl(sendId: string) { return `${TRACKING_BASE}/t/open/${sendId}.gif`; }
function clickUrl(sendId: string, target: string) { return `${TRACKING_BASE}/t/click/${sendId}?u=${encodeURIComponent(target)}`; }
function unsubUrl(sendId: string) { return `${TRACKING_BASE}/t/unsub/${sendId}`; }

export function plainToTrackedHtml(plainBody: string, sendId: string): string {
  const escaped = plainBody
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Markdown links first: [text](url) → <a href="url">text</a>
  const mdLinked = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text, url) => `<a href="${clickUrl(sendId, url)}" style="color:#0366d6;text-decoration:underline">${text}</a>`,
  );

  // Then any remaining bare URLs
  const linked = mdLinked.replace(
    /(?<!["'>])(https?:\/\/[^\s<>"]+)/g,
    (url) => `<a href="${clickUrl(sendId, url)}" style="color:#0366d6">${url}</a>`,
  );

  const bolded = linked.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  const withBreaks = bolded.replace(/\n/g, "<br>\n");

  const logoBlock = LOGO_URL
    ? `<br><br><img src="${LOGO_URL}" alt="IIT Bombay" style="display:block;border:0;margin-top:8px;max-width:120px;height:auto" />`
    : "";
  // No unsubscribe footer (per user preference - personal outreach feel).
  const pixel = `<img src="${pixelUrl(sendId)}" width="1" height="1" alt="" style="display:block;border:0" />`;

  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${withBreaks}${logoBlock}${pixel}</div>`;
}

export function plainWithFooter(plainBody: string, _sendId: string): string {
  return plainBody
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1");
}
