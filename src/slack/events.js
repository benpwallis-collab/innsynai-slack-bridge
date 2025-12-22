import { resolveTeamId } from "../tenant/resolve.js";
import { getTenantAndSlackClient } from "../tenant/lookup.js";
import { processInsightsSignal } from "../insights/ingest.js";
import { formatAnswerBlocks } from "../helpers/formatting.js";

export default function registerEvents(app) {
  console.log("📡 Events registered");

  // --------------------------------------------------
  // App Home (Slack App Directory requirement)
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
                text:
                  "*👋 Welcome to InnsynAI*\n\n" +
                  "InnsynAI helps your team find answers using internal documents."
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
                  text: {
                    type: "plain_text",
                    text: "Open Dashboard"
                  },
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
  // Message Events (mentions + interventions)
  // --------------------------------------------------
  app.message(async ({ message, context, body }) => {
    try {
      // --------------------------------------------------
      // Guard rails
      // --------------------------------------------------
      if (!message || message.bot_id || message.subtype) return;
      if (!message.text) return;

      // IMPORTANT:
      // We intentionally do NOT handle mentions or interventions in DMs.
      // Slash commands (/ask) are handled elsewhere and still allowed.
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

      // --------------------------------------------------
      // 3. @InnsynAI mention handling (channel-only)
      // --------------------------------------------------
      const botUserId = context?.botUserId || process.env.SLACK_BOT_USER_ID;
      const isBotMention =
        typeof botUserId === "string" && botUserId.length > 0
          ? message.text.includes(`<@${botUserId}>`)
          : false;

      if (isBotMention) {
        const question = message.text
          .replace(new RegExp(`<@${botUserId}>`, "g"), "")
          .trim();

        if (question.length > 0) {
          const ragRes = await fetch(process.env.RAG_QUERY_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: process.env.SUPABASE_ANON_KEY,
              "x-tenant-id": tenant_id
            },
            body: JSON.stringify({
              question,
              source: "slack"
            })
          });

          const data = await ragRes.json();

          const blocks = formatAnswerBlocks(
            question,
            data?.answer || "I couldn’t generate an answer.",
            data?.sources || [],
            data?.qa_log_id
          );

          await slackClient.chat.postMessage({
            channel: message.channel,
            thread_ts: message.thread_ts || message.ts,
            text: data?.answer || "I couldn’t generate an answer.",
            blocks
          });

          return;
        }
      }

      // --------------------------------------------------
      // 4. Slack Interventions (channel-only)
      // --------------------------------------------------
      const interventionRes = await fetch(
        `${process.env.SUPABASE_URL}/functions/v1/slack-intervention`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.SUPABASE_ANON_KEY,
            "x-tenant-id": tenant_id
          },
          body: JSON.stringify({
            tenant_id,
            slack_team_id: teamId,
            message_text: message.text,
            metadata: {
              channel_id: message.channel,
              thread_ts: message.thread_ts,
              user_id: message.user,
              message_ts: message.ts
            }
          })
        }
      );

      const raw = await interventionRes.text();
      let intervention;
      try {
        intervention = JSON.parse(raw);
      } catch {
        return;
      }

      if (!intervention?.should_respond || !intervention?.reply_text) return;

      const blocks = formatAnswerBlocks(
        message.text,
        intervention.reply_text,
        Array.isArray(intervention.sources) ? intervention.sources : [],
        intervention.qa_log_id || intervention.qaLogId || intervention.log_id || null
      );

      const respondMode =
        typeof intervention.respond_mode === "string"
          ? intervention.respond_mode.toLowerCase().trim()
          : "";

      if (respondMode === "ephemeral") {
        try {
          await slackClient.chat.postEphemeral({
            channel: message.channel,
            user: message.user,
            text: intervention.reply_text,
            blocks
          });
          return;
        } catch {}
      }

      if (respondMode === "thread_reply") {
        await slackClient.chat.postMessage({
          channel: message.channel,
          thread_ts: message.thread_ts || message.ts,
          text: intervention.reply_text,
          blocks
        });
        return;
      }

      await slackClient.chat.postMessage({
        channel: message.channel,
        text: intervention.reply_text,
        blocks
      });
    } catch (err) {
      console.error("❌ Message handler error:", err);
    }
  });
}
