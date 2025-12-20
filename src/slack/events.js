import { resolveTeamId } from "../tenant/resolve.js";
import { getTenantAndSlackClient } from "../tenant/lookup.js";
import { processInsightsSignal } from "../insights/ingest.js";

export default function registerEvents(app) {
  console.log("📡 Events registered");

  app.message(async ({ message, context, body }) => {
    try {
      // --------------------------------------------------
      // Guard rails
      // --------------------------------------------------
      if (!message || message.bot_id || message.subtype) return;
      if (!message.text) return;

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
            .then(res => {
              if (Array.isArray(res?.messages) && res.messages.length) {
                threadMessages = res.messages
                  .filter(m => m?.text)
                  .map(m => ({
                    user_id: m.user,
                    text: m.text,
                    timestamp: m.ts,
                    is_bot: Boolean(m.bot_id)
                  }));
              }
            })
            .catch(() => {})
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

      // --------------------------------------------------
      // 3. Slack Interventions
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

      // --------------------------------------------------
      // SAFE source rendering (deployment-safe)
      // --------------------------------------------------
      let sourcesText = "";

      if (Array.isArray(intervention.sources) && intervention.sources.length > 0) {
        const sourcesList = intervention.sources
          .map((s) => {
            if (!s) return null;
            if (typeof s === "string") return `• ${s}`;
            if (s.title && s.url) return `• ${s.title} (${s.url})`;
            if (s.title) return `• ${s.title}`;
            return null;
          })
          .filter(Boolean);

        if (sourcesList.length > 0) {
          sourcesText = `\n\nSources:\n${sourcesList.join("\n")}`;
        }
      }

      const fullText = `${intervention.reply_text}${sourcesText}`;

      const channel = message.channel;
      const respondMode =
        typeof intervention.respond_mode === "string"
          ? intervention.respond_mode.toLowerCase().trim()
          : "";

      if (respondMode === "ephemeral") {
        try {
          await slackClient.chat.postEphemeral({
            channel,
            user: message.user,
            text: fullText
          });
          return;
        } catch {}
      }

      if (respondMode === "thread_reply") {
        await slackClient.chat.postMessage({
          channel,
          text: fullText,
          thread_ts: message.thread_ts || message.ts
        });
        return;
      }

      await slackClient.chat.postMessage({
        channel,
        text: fullText
      });
    } catch (err) {
      console.error("❌ Message handler error:", err);
    }
  });
}
