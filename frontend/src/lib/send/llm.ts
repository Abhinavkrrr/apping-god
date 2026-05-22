// Server-side Gemini opener rewrite. Caches per-company in companies.recent_news.
import { createAdminClient } from "@/lib/supabase/admin";

const SYSTEM_PROMPT = `You are rewriting the opening line of a cold outreach email from an
IIT Bombay undergraduate (Abhinav Kumar) to someone at a target company.

Constraints:
- Output EXACTLY ONE sentence, 15-25 words.
- Mention something specific about the company that signals attention.
- Sound like a real human, NOT marketing-speak.
- Start with "I" or "Your" or "What" — never with a corporate cliche.
- Do NOT include any greeting, sign-off, quotes, markdown, or trailing newline.
- Output PLAIN TEXT only.`;

export async function rewriteCompanyBrief(company: {
  id: string;
  name: string;
  domain?: string | null;
  industry?: string | null;
  brief_one_line?: string | null;
  recent_news?: Record<string, unknown> | null;
}): Promise<string> {
  const fallback = company.brief_one_line || `I came across ${company.name}'s work and wanted to reach out.`;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fallback;

  // Cache check
  const cache = (company.recent_news as any)?.gemini_opener_v1;
  if (cache && typeof cache === "string") return cache;

  const userPrompt = `Company: ${company.name}
${company.domain ? `Domain: ${company.domain}\n` : ""}${company.industry ? `Industry: ${company.industry}\n` : ""}${company.brief_one_line ? `Existing brief (rewrite, don't quote verbatim):\n${company.brief_one_line}` : "No existing brief — use what you know about this company."}

Now write the one-sentence opener:`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 80 },
        }),
      }
    );
    const json = await res.json();
    let text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text || typeof text !== "string" || text.length < 10) return fallback;
    text = text.replace(/^["'`]+|["'`]+$/g, "").trim();

    // Cache
    const sb = createAdminClient();
    const newCache = { ...((company.recent_news as object) ?? {}), gemini_opener_v1: text };
    await sb.from("companies").update({ recent_news: newCache }).eq("id", company.id);

    return text;
  } catch {
    return fallback;
  }
}
