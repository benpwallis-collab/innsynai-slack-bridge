import { getRelativeDate } from "./date.js";

export function formatAnswerBlocks(question, answer, sources, qaLogId) {
  const blocks = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `💡 *Answer to:* ${question}\n\n${answer}` }
    }
  ];

  if (sources?.length) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Sources:*\n" +
          sources
            .map(
              (s) =>
                `• ${s.url ? `<${s.url}|${s.title}>` : s.title} (Updated ${getRelativeDate(
                  s.updated_at
                )})`
            )
            .join("\n")
      }
    });
  }

  if (qaLogId) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "actions",
      block_id: `feedback_${qaLogId}`,
      elements: [
        {
          type: "button",
          action_id: "feedback_up",
          text: { type: "plain_text", text: "👍 Helpful" },
          value: qaLogId
        },
        {
          type: "button",
          action_id: "feedback_down",
          text: { type: "plain_text", text: "👎 Not Helpful" },
          value: qaLogId
        }
      ]
    });
  }

  return blocks;
}
