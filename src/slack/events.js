import { resolveTeamId } from "../tenant/resolve.js";
import { getTenantAndSlackClient } from "../tenant/lookup.js";
import { processInsightsSignal } from "../insights/ingest.js";
import { formatAnswerBlocks } from "../helpers/formatting.js";

export default function registerEvents(app) {
  console.log("📡 Events registered");

  // --------------------------------------------------
  // App Home (required for Slack App Directory)
  // --------------------------------------------------
  app.event("app_home_opened", async ({ event, client }) => {
    try {
      await client.views.publish({
        user_id: event.user,
        view: {
          type: "home",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*👋 Welcome to InnsynAI*\n\nInnsynAI helps your team find answers using internal documents."
              }
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text:
                  "*Getting started:*\n" +
                  "1. Connect your documents\n" +
                  "2. Ask questions with `/ask`\n" +
                  "3. Manage settings in the dashboard"
              }
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Open Dashboard" },
                  url: "https://app.innsynai.com"
                }
              ]
            }
          ]
        }
      });
    } catch (err) {
      console.error("❌ Failed to publish App Home:", err);
    }
  });

  // --------------------------------------------------
  // Existing message handling (unchanged)
  // --------------------------------------------------
  app.message(async ({ message, context, body }) => {
    try {
      // --------------------------------------------------
      // Guard rails
      // --------------------------------------------------
      if (!message || message.bot_id || message.subtype) return;
      if (!message.text) return;

      // Ignore Events API handling in DMs and Group DMs
      // (Slash commands are handled elsewhere and still allowed)
      if (message.channel_type === "im" || message.channel_type === "mpim") {
        return;
      }

      const teamId = resolveTeamId({ message, context, body });
      if (!teamId) return;

      const { tenant_id, slackClient } = await getTenantAndSlackClient({ teamId });

      // --------------------------------------------------
      // 1. Insights ingestion (unchanged)
      // --------------------------------------------------
      processInsightsSignal(message, tenant_id);

      // --------------------------------------------------
      // 2. Human Answer Capture (fire-and-forget)
      // --------------------------------------------------
      (() => {
        try {
          const threadTs = message.thread_ts || message.ts;

          let threadMessages = [
            {
              user_id: message.user,
              text: message.text,
              timestamp: message.ts,
              is_bot: false
            }
          ];

          slackClient.conversations
            .replies({
              channel: message.channel,
              ts: threadTs,
              limit: 15
            })
            .then((res) => {
              if (Array.isArray(res?.messages) && res.messages.length) {
                threadMessages = res.messages
                  .filter((m) => m?.text)
                  .map((m) => ({
                    user_id: m.user,
                    text: m.text,
                    timestamp: m.ts,
                    is_bot: Boolean(m.bot_id)
                  }));
              }
            })
            .catch(() => {})
            .finally(() => {
              fetch(`${process.env.SUPABASE_URL}/functions/v1/capture-human-answers`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  apikey: process.env.SUPABASE_ANON_KEY
                },
                body: JSON.stringify({
                  tenant_id,
                  source_type: "slack",
                  slack_team_id: teamId,
                  thread_messages: threadMessages,
                  source_reference: {
                    channel_id: message.channel,
                    thread_ts: threadTs
                  }
                })
              }).catch(() => {});
            });
        } catch {}
      })();

      // (rest of your file continues unchanged)
