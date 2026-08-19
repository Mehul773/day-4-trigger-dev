# AI News → Slack Digest

A Trigger.dev automation that gathers the week's AI and tech news, writes it up as a readable digest, and posts it to Slack.

Runs every Monday at 8:15am IST.

## What it does

1. Gathers news from OpenAI's blog, TechCrunch AI, The Verge AI, Hacker News, and two live Tavily web searches (one focused on new Claude Code / Anthropic dev-tool features, one on general major AI/tech news).
2. Sends everything to Gemini to pick the 5-8 items that actually matter for a software team, and write them up in a readable voice with a "why this matters" takeaway per item.
3. Posts the digest to Slack via an Incoming Webhook, with a "Go deeper" section linking every source at the end.

If the AI write-up step fails, it falls back to posting a plain headline list instead of staying silent.

## Setup

```bash
npm install
```

Copy the required environment variables into `.env` (see the comments in that file for where to get each one):

- `TRIGGER_SECRET_KEY` — Trigger.dev dev API key
- `TAVILY_API_KEY` — Tavily web search (free tier)
- `GEMINI_API_KEY` — Google AI Studio
- `SLACK_WEBHOOK_URL` — Slack Incoming Webhook for the target channel

Run locally:

```bash
npx trigger.dev@latest dev
```

## Deploying to production

Add all four environment variables to the Trigger.dev dashboard (Project → Environment Variables) for both staging and prod, then:

```bash
npx trigger.dev@latest deploy
```

The schedule (`src/trigger/ai-news-digest/daily-digest.ts`) only fires in the `PRODUCTION` environment.
