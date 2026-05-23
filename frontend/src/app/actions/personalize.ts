"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { render, buildContext, plainToTrackedHtml } from "@/lib/send/render";

const SYSTEM_PROMPT = `You are rewriting a cold-outreach email body so it reads as a highly
personalized message FOR THE SPECIFIC COMPANY mentioned, not a generic template.

Rules — ALL must hold:
- Output ONLY the body of the email. No subject, no greeting prefix like 'Dear X'.
- Use the EXACT SAME structure and sections as the original template:
    salutation/greeting, intro, Professional Experience, Key Projects,
    Institute Leadership, closing ask, signature.
- Keep ALL the same bullet points, achievements, numbers, projects.
- Keep all **bold** markers exactly as they are.
- Keep all {{variables}} like {{first_name}}, {{company}} untouched -
  someone else will substitute them.
- ONLY change the SECOND paragraph (the one that follows the greeting
  and self-intro). That paragraph should reference the company by name
  ({{company}}) and say something SPECIFIC about their work that signals
  the writer has done their homework. 1-2 sentences.
- Match the tone of the rest of the email exactly: warm-formal, no slang.
- DO NOT add new bullet points or new sections.
- DO NOT remove or shorten the experience / projects / leadership sections.
- DO NOT change the signature, phone, LinkedIn link, or college line.

Output PLAIN TEXT with the same line breaks and markdown formatting.`;

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1400 },
        }),
      }
    );
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || null;
  } catch (e) {
    console.error("Gemini call failed:", e);
    return null;
  }
}

/** Per-row AI personalization. Rewrites the rendered_body so the
 * second paragraph is uniquely tailored to the contact's company. */
export async function personalizeSingleSend(sendId: string) {
  const sb = createAdminClient();

  // Load full context
  const { data: send } = await sb.from("sends").select(`
    id, template_id, contact_id,
    contacts(first_name, last_name, email, title, companies(id, name, domain, industry, brief_one_line))
  `).eq("id", sendId).single();
  if (!send) return { ok: false, error: "Send not found." };

  const c = (send as any).contacts;
  const company = c?.companies;
  if (!c || !company) return { ok: false, error: "Missing contact or company." };

  // Get the base template body (master Outreach first-touch)
  const { data: tpl } = await sb.from("templates").select("subject_tmpl, body_tmpl")
    .eq("id", send.template_id).single();
  if (!tpl) return { ok: false, error: "Template not found." };

  // Build the prompt
  const userPrompt = `Company: ${company.name}
${company.domain ? `Domain: ${company.domain}\n` : ""}${company.industry ? `Industry: ${company.industry}\n` : ""}${company.brief_one_line ? `Existing 1-liner about them:\n${company.brief_one_line}` : "No existing brief — use what you know about this company from your training."}

The exact template body to rewrite (preserve everything EXCEPT the second paragraph after the greeting+intro):

---
${tpl.body_tmpl}
---

Now output the rewritten body in full, with ONLY the second paragraph adjusted to be uniquely about ${company.name}.`;

  const newBody = await callGemini(SYSTEM_PROMPT, userPrompt);
  if (!newBody) return { ok: false, error: "Gemini did not return a body. Try again." };

  // Render with substitutions (the template variables stay until this point)
  const ctx = buildContext(c, company, {
    company_brief_one_line: company.brief_one_line ?? "",
  });
  const subject = render(tpl.subject_tmpl, ctx);
  const renderedText = render(newBody, ctx);
  const renderedHtml = plainToTrackedHtml(renderedText, sendId);

  const { error } = await sb.from("sends").update({
    rendered_subject: subject,
    rendered_body: renderedHtml,
  }).eq("id", sendId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/approve");
  return { ok: true, preview: renderedText.slice(0, 160) };
}
