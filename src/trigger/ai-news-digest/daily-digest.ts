import { logger, schedules } from "@trigger.dev/sdk";
import { gatherAllSources } from "./sources.js";
import { generateDigest, fallbackHeadlineList } from "./gemini.js";
import { postToSlack, quietDayMessage, todayLabel } from "./slack.js";

const REQUIRED_ENV_VARS = ["TAVILY_API_KEY", "GEMINI_API_KEY", "SLACK_WEBHOOK_URL"] as const;

export const aiNewsDigest = schedules.task({
  id: "ai-news-digest",
  cron: {
    pattern: "15 8 * * 1", // every Monday, 8:15am IST
    timezone: "Asia/Calcutta", // Trigger.dev's supported list uses this alias, not "Asia/Kolkata"
    environments: ["PRODUCTION"],
  },
  maxDuration: 120,
  run: async () => {
    for (const key of REQUIRED_ENV_VARS) {
      if (!process.env[key]) throw new Error(`${key} is not set`);
    }

    const dateLabel = todayLabel();

    const items = await gatherAllSources();
    logger.log(`Gathered ${items.length} candidate news items`);

    if (items.length === 0) {
      await postToSlack(quietDayMessage(), dateLabel);
      return { itemCount: 0, posted: true };
    }

    const digestText = await generateDigest(items).catch((error) => {
      logger.error("Gemini digest generation failed, falling back to raw headlines", {
        error: error instanceof Error ? error.message : String(error),
      });
      return fallbackHeadlineList(items);
    });

    await postToSlack(digestText, dateLabel);

    return { itemCount: items.length, posted: true };
  },
});
