// Lightweight {{var}} substitution + markdown-bold renderer for previews
import Mustache from "mustache";

// Disable HTML escaping
Mustache.escape = (t: string) => t;

export function renderTemplate(template: string, ctx: Record<string, string>): string {
  return Mustache.render(template || "", ctx);
}

export function plainToBoldHtml(plain: string): string {
  const escaped = plain
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const bolded = escaped.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  return bolded.replace(/\n/g, "<br>\n");
}

export const SAMPLE_CTX = {
  first_name: "Vaibhav",
  company: "Better Capital",
  company_brief_one_line:
    "I've been reading about Better Capital's focus on supporting founders at the earliest stages and found your investment philosophy very compelling.",
  full_name: "Vaibhav Domkundwar",
  title: "Founder & CEO",
};
