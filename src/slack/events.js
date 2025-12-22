import { resolveTeamId } from "../tenant/resolve.js";
import { getTenantAndSlackClient } from "../tenant/lookup.js";
import { processInsightsSignal } from "../insights/ingest.js";
import { formatAnswerBlocks } from "../helpers/formatting.js";

/**
 * Registers all Slack event handlers.
 * NOTE: Slack payload shapes differ between commands, events, and actions.
 * This file explicitly normalizes team_id resolution per event type.
 */
export default function registerEvents(app) {
  console.log("📡 Events registered");

  // --------------------------------------------------
  // App Home (FIXED: tenant-aware client)
  // --------------------------------------------------
  app.event("app_home_opened", async ({ event, context }) => {
    try {
      const teamId =
        event.team_id ||
        event.team ||
        context?.teamId;

      if (!teamId) {
        console.error("❌ app_home_opened: missing teamId");
        return;
      }

      const { slackClient } = await getTenantAndSlackClient({ teamId });

      await slackClient.views.publish({
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
                  text: { type: "plain_text", text: "Open Dashboard" },
                  url: "https://innsynai.app/dashboard"
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
  // 1. Explicit @mention handler
  // --------------------------------------------------
  app.event("app_mention", async ({ event, context }) => {
    try {
      if (!event?.text || !event?.channel) return;

      const teamId =
        event.team ||
        context?.teamId ||
        resolveTeamId({ message: event, context, body: null });

      if (!teamId) {
        console.error("❌ app_mention: unable to resolve team id");
        return;
      }

      const { tenant_id, slackClient } =
        await getTenantAndSlackClient({ teamId });

      const botUserId = context?.botUserId;
      if (!botUserId) return;

      const question = event.text
        .replace(new RegExp(`<@${botUserId}>`, "g"), "")
        .trim();

      if (!question) return;

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
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        text: data?.answer || "I couldn’t generate an answer.",
        blocks
      });
    } catch (err) {
      console.error("❌ app_mention handler error:", err);
    }
  });

  // --------------------------------------------------
  // 2. Message handler (ingestion + interventions ONLY)
  // --------------------------------------------------
  app.message(async ({ message, context, body }) => {
    try {
      if (!message?.text) return;
      if (message.bot_id) return;

      // Ignore DMs
      if (message.channel_type === "im" || message.channel_type === "mpim") {
        return;
      }

      const teamId = resolveTeamId({ message, context, body });
      if (!teamId) return;

      const { tenant_id, slackClient } =
        await getTenantAndSlackClient({ teamId });

      // Insights ingestion
      processInsightsSignal(message, tenant_id);

      // Human answer capture (fire-and-forget)
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
              if (Array.isArray(res?.messages)) {
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
            .finally(() => {
              fetch(
                `${process.env.SUPABASE_URL}/functions/v1/capture-human-answers`,
                {
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
                }
              ).catch(() => {});
            });
        } catch {}
      })();

      // Slack Interventions
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
        intervention.qa_log_id || intervention.log_id || null
      );

      const respondMode =
        typeof intervention.respond_mode === "string"
          ? intervention.respond_mode.toLowerCase()
          : "";

      if (respondMode === "ephemeral") {
        await slackClient.chat.postEphemeral({
          channel: message.channel,
          user: message.user,
          text: intervention.reply_text,
          blocks
        });
        return;
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
