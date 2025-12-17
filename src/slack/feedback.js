// feedback.js
import { getTenantAndSlackClient } from "../tenant/lookup.js";
import { resolveTeamId } from "../tenant/resolve.js";

export default function registerFeedback(app) {
  console.log("📝 Feedback handlers registered");

  app.action("feedback_up", async ({ ack, body, action, client }) => {
    await ack();
    await handleFeedbackAction(body, action, client, "up");
  });

  app.action("feedback_down", async ({ ack, body, action, client }) => {
    await ack();
    await handleFeedbackAction(body, action, client, "down");
  });
}

async function handleFeedbackAction(body, action, client, feedback) {
  const qaLogId = action.value;
  const slackUserId = body.user?.id;
  const channelId = body.channel?.id;
  const messageTs = body.message?.ts;

  console.log(`👍 Feedback ${feedback} for qa_log_id: ${qaLogId}`);

  if (!qaLogId) {
    console.error("❌ No qa_log_id in feedback action");
    return;
  }

  try {
    // Get tenant info
    const teamId = body.team?.id || body.user?.team_id;
    const { tenant_id } = await getTenantAndSlackClient({ teamId });

    // Submit feedback to edge function
    const feedbackRes = await fetch(
      `${process.env.SUPABASE_URL}/functions/v1/feedback`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": process.env.INTERNAL_LOOKUP_SECRET
        },
        body: JSON.stringify({
          qa_log_id: qaLogId,
          feedback: feedback,
          source: "slack",
          tenant_id: tenant_id,
          slack_user_id: slackUserId
        })
      }
    );

    if (!feedbackRes.ok) {
      const errorText = await feedbackRes.text();
      console.error("❌ Feedback submission failed:", errorText);
      return;
    }

    console.log("✅ Feedback submitted successfully");

    // Update the Slack message to show feedback was recorded
    if (channelId && messageTs) {
      const originalBlocks = body.message?.blocks || [];
      
      // Remove the feedback buttons and add acknowledgment
      const updatedBlocks = originalBlocks
        .filter((block) => block.type !== "actions" && block.type !== "divider")
        .concat([
          { type: "divider" },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: feedback === "up" 
                  ? "✅ Thanks for your feedback!" 
                  : "✅ Thanks for your feedback – we'll work on improving."
              }
            ]
          }
        ]);

      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        blocks: updatedBlocks,
        text: body.message?.text || "Answer"
      });
    }
  } catch (err) {
    console.error("❌ Feedback error:", err);
  }
}
