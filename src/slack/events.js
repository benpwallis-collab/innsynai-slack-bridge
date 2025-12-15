import { resolveTeamId } from "../tenant/resolve.js";
import { getTenantAndSlackClient } from "../tenant/lookup.js";
import { processInsightsSignal } from "../insights/ingest.js";

export default function registerEvents(app) {
  console.log("📡 Events registered");

  app.message(async ({ message, context, body }) => {
    try {
      if (!message || message.bot_id || message.subtype) return;

      const teamId = resolveTeamId({ message, context, body });
      if (!teamId) return;

      const { tenant_id, slackClient } = await getTenantAndSlackClient({ teamId });

      // --------------------------------------------------
      // 1. Existing: Insights ingestion
      // --------------------------------------------------
      processInsightsSignal(message, tenant_id);

      // --------------------------------------------------
      // 2. NEW: Human Answer Capture (fire-and-forget)
      // --------------------------------------------------
      try {
        if (message.text) {
          const threadTs = message.thread_ts || message.ts;

          let threadMessages = [];

          try {
            const replies = await slackClient.conversations.replies({
              channel: message.channel,
              ts: threadTs,
              limit: 15
            });

            threadMessages = (replies.messages || []).map(m => ({
              user_id: m.user,
              text: m.text,
              timestamp: m.ts,
              is_bot: !!m.bot_id
            }));
          } catch {
            // Fallback: single message only
            threadMessages = [{
              user_id: message.user,
              text: message.text,
              timestamp: message.ts,
              is_bot: false
            }];
          }

          // IMPORTANT:
          // - No feature checks here
          // - No service role usage
          // - Edge function performs ALL gating
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
          );
        }
      } catch {
        // Absolute no-op: capture must never affect message handling
      }

      // --------------------------------------------------
      // 3. Existing: Slack interventions (separate feature)
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

      if (!intervention.should_respond || !intervention.reply_text) return;

      const replyText = intervention.reply_text;
      const channel = message.channel;
      const respondMode = (intervention.respond_mode || "").toLowerCase().trim();

      if (respondMode === "ephemeral") {
        try {
          await slackClient.chat.postEphemeral({
            channel,
            user: message.user,
            text: replyText
          });
          return;
        } catch {
          // fallback
        }
      }

      if (respondMode === "thread_reply") {
        await slackClient.chat.postMessage({
          channel,
          text: replyText,
          thread_ts: message.thread_ts || message.ts
        });
        return;
      }

      await slackClient.chat.postMessage({
        channel,
        text: replyText
      });

    } catch (err) {
      console.error("❌ Message handler error:", err);
    }
  });
}
