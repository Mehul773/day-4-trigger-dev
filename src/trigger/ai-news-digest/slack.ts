const SLACK_SECTION_MAX_CHARS = 2900; // Slack hard-caps mrkdwn section text at 3000

export function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function quietDayMessage(): string {
  return "No fresh AI or tech news worth flagging turned up in the last day. Back tomorrow.";
}

function chunkText(text: string, maxChars: number): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars) {
      if (current) chunks.push(current);
      current = paragraph.length > maxChars ? paragraph.slice(0, maxChars) : paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks.length > 0 ? chunks : [text.slice(0, maxChars)];
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
}

function buildBlocks(digestText: string, dateLabel: string): SlackBlock[] {
  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: `🗞️ AI & Tech Digest — ${dateLabel}`.slice(0, 150) } },
    { type: "divider" },
  ];

  for (const chunk of chunkText(digestText, SLACK_SECTION_MAX_CHARS)) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
  }

  return blocks;
}

export async function postToSlack(digestText: string, dateLabel: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("SLACK_WEBHOOK_URL is not set");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `AI & Tech Digest — ${dateLabel}`,
      blocks: buildBlocks(digestText, dateLabel),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook POST failed: HTTP ${res.status} ${body}`);
  }
}
