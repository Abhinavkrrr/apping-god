// LLM personalization via Gemini 2.0 Flash.
// Rewrites the {{company_brief_one_line}} so each company gets a fresh,
// natural opener. Cached per company in companies.recent_news JSONB.
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSupabase } = require("./supabase");

const _key = process.env.GEMINI_API_KEY;
const _gen = _key ? new GoogleGenerativeAI(_key) : null;

const SYSTEM_PROMPT = `You are rewriting the opening line of a cold outreach email from an
IIT Bombay undergraduate (Abhinav Kumar) to someone at a target company.

Constraints:
- Output EXACTLY ONE sentence, 15-25 words.
- Mention something specific about the company that signals attention
  (their product, market position, recent direction, philosophy).
- Sound like a real human, NOT marketing-speak. No "I hope this finds you well",
  no "I've been deeply impressed", no superlatives.
- Start with "I" or "Your" or "What" — never with a corporate cliche.
- Do NOT include any greeting, sign-off, quotes, markdown, or trailing newline.
- Output PLAIN TEXT only.`;

/**
 * Rewrite the company brief line. Falls back to the existing brief if Gemini fails.
 * Caches results in companies.recent_news.gemini_opener_v1.
 */
async function rewriteCompanyBrief({ company, useCache = true }) {
  const fallback = company.brief_one_line || `I came across ${company.name}'s work and wanted to reach out.`;

  if (!_gen) return fallback;

  // Cache check
  if (useCache && company.recent_news?.gemini_opener_v1) {
    return company.recent_news.gemini_opener_v1;
  }

  const userPrompt = `Company: ${company.name}
${company.domain ? `Domain: ${company.domain}\n` : ""}${company.industry ? `Industry: ${company.industry}\n` : ""}${company.brief_one_line ? `Existing brief (rewrite, don't quote verbatim):\n${company.brief_one_line}` : "No existing brief — use what you know about this company."}

Now write the one-sentence opener:`;

  try {
    const model = _gen.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { temperature: 0.7, maxOutputTokens: 80 },
    });
    const result = await model.generateContent(userPrompt);
    let text = result.response.text().trim();
    // Strip surrounding quotes if Gemini added any
    text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!text || text.length < 10) return fallback;

    // Cache it
    const sb = getSupabase();
    const newCache = { ...(company.recent_news || {}), gemini_opener_v1: text };
    await sb.from("companies").update({ recent_news: newCache }).eq("id", company.id);

    return text;
  } catch (e) {
    console.warn(`  [llm] Gemini fail for "${company.name}": ${e.message}. Using fallback.`);
    return fallback;
  }
}

module.exports = { rewriteCompanyBrief };
