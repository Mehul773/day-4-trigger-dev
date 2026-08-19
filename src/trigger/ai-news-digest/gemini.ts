import { logger } from "@trigger.dev/sdk";
import type { NewsItem } from "./types.js";

const GEMINI_MODEL = "gemini-flash-lite-latest";

const SYSTEM_PROMPT = `You write a daily AI/tech news digest for a software engineering team's Slack channel. Your job is to make the team's AI knowledge compound, not to dump headlines.

RULES (follow all of them):
- Every fact must be real and traceable to one of the source items given to you. Never invent a number, quote, or detail. This is reporting, not a story.
- Line 1 is a hook, not a headline restatement. Lead with the single most surprising or consequential thing, or a concrete stake. Never open with "Here's this week's AI news" or similar.
- Be interested, not interesting: write like you're genuinely pointing a teammate at something useful, not performing vocabulary. Make the reader feel it's about them: what changes for how we build, what tool now does the thing we complained about.
- Concrete over abstract. Use real numbers, names, dates, products. Never "several companies" or "significant progress."
- Every word earns its place. Short and high-signal beats long. Cut hedges, throat-clearing, restated points.
- Plain words. Zero corporate stock phrases (examples to avoid: "game-changer", "unlock", "in today's fast-paced world", "seamless", "robust", "supercharge", "elevate", "harness the power of"). Say it the way you'd say it out loud. Technical terms and proper nouns (Claude Code, API, specific model names) stay exact. This is about register, not dumbing down.
- Zero em dash (—) and zero spaced en dash (–) anywhere in the output. Use a period, comma, colon, or parentheses instead.
- One clear takeaway per item, stated plainly.
- Priority order when picking which items to include: (1) new Claude Code or Anthropic developer-tool features, (2) major AI news, (3) major general tech-market news. Pick the best 5-8 items total, dedupe near-identical stories across sources.
- Output format: plain text using ONLY Slack-safe mrkdwn: *bold*, _italic_, and • for bullets. Do NOT use markdown headers (#), do NOT use fenced code blocks.
- Target roughly 2000-2500 characters total.
- End with a section titled "Go deeper" (as *Go deeper*) that lists every source item you referenced, as "• <title> — <url>", so the team can read the originals.

If the source items given to you contain nothing genuinely worth a team's attention, say so plainly and briefly instead of padding out low-value items.`;

function buildUserPrompt(items: NewsItem[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const payload = items.map((item) => ({
    title: item.title,
    url: item.url,
    source: item.source,
    publishedAt: item.publishedAt,
    snippet: item.snippet,
  }));
  return `Today's date: ${today}\n\nRaw items (JSON):\n${JSON.stringify(payload, null, 2)}\n\nWrite today's digest now, following every rule in the system instructions.`;
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

export async function generateDigest(items: NewsItem[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildUserPrompt(items) }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 2048, topP: 0.95 },
      }),
      signal: AbortSignal.timeout(30_000),
    }
  );

  const data = (await res.json()) as GeminiResponse;

  if (!res.ok) {
    throw new Error(
      `Gemini API error ${res.status}${data.error?.status ? ` (${data.error.status})` : ""}: ${data.error?.message ?? "unknown error"}`
    );
  }

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
  }

  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error("Gemini returned no candidates");
  }

  if (candidate.finishReason === "SAFETY" || candidate.finishReason === "RECITATION") {
    throw new Error(`Gemini refused to generate: finishReason=${candidate.finishReason}`);
  }

  if (candidate.finishReason === "MAX_TOKENS") {
    logger.warn("Gemini response may be truncated (finishReason=MAX_TOKENS)");
  }

  const text = candidate.content?.parts?.[0]?.text;
  if (!text || !text.trim()) {
    throw new Error("Gemini returned an empty response");
  }

  return text.trim();
}

export function fallbackHeadlineList(items: NewsItem[]): string {
  const lines = items
    .slice(0, 10)
    .map((item) => `• *${item.source}*: <${item.url}|${item.title}>`);
  return [
    "_The AI write-up failed today, so here are today's raw headlines instead:_",
    "",
    ...lines,
  ].join("\n");
}
