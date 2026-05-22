// Server-side rendering helpers — mirrors scripts/lib/tracking.js + render.js
import Mustache from "mustache";

Mustache.escape = (t: string) => t;

const TRACKING_BASE = (process.env.TRACKING_BASE_URL ?? "").replace(/\/$/, "");
const SENDER_ADDR = process.env.SENDER_PHYSICAL_ADDRESS
  ?? "IIT Bombay, Powai, Mumbai 400076, India";

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
  const linked = escaped.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    (url) => `<a href="${clickUrl(sendId, url)}" style="color:#0366d6">${url}</a>`,
  );
  const bolded = linked.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  const withBreaks = bolded.replace(/\n/g, "<br>\n");

  const footer = `<br><br><p style="font-size:11px;color:#9ca3af;line-height:1.4;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px">${SENDER_ADDR}<br><a href="${unsubUrl(sendId)}" style="color:#9ca3af">Unsubscribe</a></p>`;
  const pixel = `<img src="${pixelUrl(sendId)}" width="1" height="1" alt="" style="display:block;border:0" />`;

  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${withBreaks}${footer}${pixel}</div>`;
}

export function plainWithFooter(plainBody: string, sendId: string): string {
  const stripped = plainBody.replace(/\*\*([^*\n]+?)\*\*/g, "$1");
  return `${stripped}\n\n---\n${SENDER_ADDR}\nUnsubscribe: ${unsubUrl(sendId)}\n`;
}
