"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { render, buildContext, plainToTrackedHtml } from "@/lib/send/render";

const SYSTEM_PROMPT = `You are rewriting a cold-outreach email body so it reads as a highly
personalized message FOR THE SPECIFIC COMPANY mentioned, not a generic template.

Rules — ALL must hold:
- Output ONLY the body of the email. No subject, no preamble, no quotes, no markdown code fence.
- Use the EXACT SAME structure and sections as the original template:
    salutation/greeting, intro line, Professional Experience, Key Projects,
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

interface CallResult { text: string | null; error: string | null; }

/** Call Groq Llama 3.3 70B — primary path (high free-tier limit). */
async function callGroq(systemPrompt: string, userPrompt: string): Promise<CallResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { text: null, error: "GROQ_API_KEY missing" };
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1500,
        temperature: 0.7,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      return { text: null, error: `Groq: ${msg.slice(0, 160)}` };
    }
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text) return { text: null, error: "Groq returned empty body" };
    return { text, error: null };
  } catch (e) {
    return { text: null, error: `Groq fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Fallback: Gemini 2.0 Flash. Lower daily quota but useful if Groq is down. */
async function callGemini(systemPrompt: string, userPrompt: string): Promise<CallResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: null, error: "GEMINI_API_KEY missing" };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1500 },
        }),
      }
    );
    const json = await res.json();
    if (json?.error) return { text: null, error: `Gemini: ${(json.error.message ?? "").slice(0, 160)}` };
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return { text: null, error: "Gemini returned empty body" };
    return { text, error: null };
  } catch (e) {
    return { text: null, error: `Gemini fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Strip common markdown code-fence wrappers if the LLM accidentally added them. */
function unfence(s: string): string {
  return s
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

/** Per-row AI personalization — Groq primary, Gemini fallback. */
export async function personalizeSingleSend(sendId: string) {
  const sb = createAdminClient();

  const { data: send } = await sb.from("sends").select(`
    id, template_id, contact_id,
    contacts(first_name, last_name, email, title, companies(id, name, domain, industry, brief_one_line))
  `).eq("id", sendId).single();
  if (!send) return { ok: false, error: "Send not found." };

  const c = (send as any).contacts;
  const company = c?.companies;
  if (!c || !company) return { ok: false, error: "Missing contact or company." };

  const { data: tpl } = await sb.from("templates").select("subject_tmpl, body_tmpl")
    .eq("id", send.template_id).single();
  if (!tpl) return { ok: false, error: "Template not found." };

  const userPrompt = `Company: ${company.name}
${company.domain ? `Domain: ${company.domain}\n` : ""}${company.industry ? `Industry: ${company.industry}\n` : ""}${company.brief_one_line ? `Existing 1-liner about them:\n${company.brief_one_line}` : "No existing brief — use what you know about this company."}

The exact template body to rewrite (preserve everything EXCEPT the second paragraph after the greeting+intro):

---
${tpl.body_tmpl}
---

Now output the rewritten body in full, with ONLY the second paragraph adjusted to be uniquely about ${company.name}.`;

  // Try Groq first; fall back to Gemini if it fails
  let result = await callGroq(SYSTEM_PROMPT, userPrompt);
  let usedProvider = "Groq Llama 3.3";
  if (!result.text) {
    console.warn(`[personalize] Groq failed: ${result.error}. Falling back to Gemini.`);
    result = await callGemini(SYSTEM_PROMPT, userPrompt);
    usedProvider = "Gemini 2.0 Flash";
  }
  if (!result.text) {
    return { ok: false, error: `Both Groq and Gemini failed. Last error: ${result.error}` };
  }

  const newBody = unfence(result.text);

  // Render with substitutions
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
  return { ok: true, provider: usedProvider, preview: renderedText.slice(0, 160) };
}
