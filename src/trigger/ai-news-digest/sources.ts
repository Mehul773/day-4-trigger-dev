import { logger } from "@trigger.dev/sdk";
import Parser from "rss-parser";
import type { NewsItem } from "./types.js";

const FETCH_TIMEOUT_MS = 15_000;
const SNIPPET_MAX_LENGTH = 300;

const rssParser = new Parser();

function stripHtml(input: string | undefined): string {
  if (!input) return "";
  return input.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function toSnippet(input: string | undefined): string {
  const clean = stripHtml(input);
  return clean.length > SNIPPET_MAX_LENGTH ? `${clean.slice(0, SNIPPET_MAX_LENGTH)}…` : clean;
}

async function fetchRssFeed(url: string, sourceName: string, cutoff: Date): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const feed = await rssParser.parseString(xml);

    return (feed.items ?? [])
      .filter((item) => {
        if (!item.isoDate && !item.pubDate) return true;
        const published = new Date(item.isoDate ?? item.pubDate ?? "");
        return Number.isNaN(published.getTime()) || published >= cutoff;
      })
      .map((item) => ({
        title: item.title ?? "(untitled)",
        url: item.link ?? "",
        source: sourceName,
        publishedAt: item.isoDate ?? item.pubDate ?? "",
        snippet: toSnippet(item.contentSnippet ?? item.content ?? item.summary),
      }))
      .filter((item) => item.url);
  } catch (error) {
    logger.error(`Failed to fetch RSS feed from ${sourceName}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function fetchHackerNews(cutoff: Date): Promise<NewsItem[]> {
  try {
    const cutoffUnixSeconds = Math.floor(cutoff.getTime() / 1000);
    const url = `https://hn.algolia.com/api/v1/search_by_date?query=AI&tags=story&numericFilters=created_at_i%3E${cutoffUnixSeconds}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      hits: Array<{
        objectID: string;
        title: string | null;
        url: string | null;
        points: number | null;
        created_at: string;
        story_text: string | null;
      }>;
    };

    return data.hits
      .filter((hit) => hit.title)
      .map((hit) => ({
        title: hit.title as string,
        url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
        source: "Hacker News",
        publishedAt: hit.created_at,
        snippet: toSnippet(hit.story_text ?? `${hit.points ?? 0} points on Hacker News`),
      }));
  } catch (error) {
    logger.error("Failed to fetch Hacker News", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function fetchTavily(query: string, sourceLabel: string): Promise<NewsItem[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        topic: "news",
        days: 8,
        max_results: 6,
        search_depth: "basic",
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      results: Array<{
        title: string;
        url: string;
        content: string;
        published_date?: string;
      }>;
    };

    return data.results.map((result) => ({
      title: result.title,
      url: result.url,
      source: sourceLabel,
      publishedAt: result.published_date ?? "",
      snippet: toSnippet(result.content),
    }));
  } catch (error) {
    logger.error(`Failed to fetch Tavily results for "${query}"`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function dedupeByUrl(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const deduped: NewsItem[] = [];
  for (const item of items) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    deduped.push(item);
  }
  return deduped;
}

export async function gatherAllSources(): Promise<NewsItem[]> {
  // Weekly cron (every Monday) → lookback slightly wider than 7 days so nothing
  // slips through the cron boundary, per this project's own scheduling guidance.
  const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

  const results = await Promise.allSettled([
    fetchRssFeed("https://openai.com/news/rss.xml", "OpenAI", cutoff),
    fetchRssFeed("https://techcrunch.com/category/artificial-intelligence/feed/", "TechCrunch", cutoff),
    fetchRssFeed("https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", "The Verge", cutoff),
    fetchHackerNews(cutoff),
    fetchTavily("Anthropic Claude Code new feature update this week", "Tavily: Claude Code"),
    fetchTavily("major AI or tech industry news this week", "Tavily: Tech News"),
  ]);

  const items: NewsItem[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      logger.error("Unexpected source-fetch rejection", { error: String(result.reason) });
    }
  }

  return dedupeByUrl(items);
}
