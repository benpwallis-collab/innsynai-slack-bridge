import { getRelativeDate } from "./date.js";

// Helper: platform label formatter
function getPlatformLabel(source) {
  const labels = {
    notion: 'Notion',
    confluence: 'Confluence',
    gitlab: 'GitLab',
    google_drive: 'Google Drive',
    sharepoint: 'SharePoint',
    manual: 'Manual Upload',
    slack: 'Slack',
    teams: 'Teams',
  };
  return labels[source] || source || 'Unknown';
}

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
            .map((s) => {
              const platform = getPlatformLabel(s.source);
              const updated = getRelativeDate(s.updated_at);
              return s.url 
                ? `• <${s.url}|${s.title}> — ${platform} (Updated ${updated})`
                : `• ${s.title} — ${platform} (Updated ${updated})`;
            })
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
