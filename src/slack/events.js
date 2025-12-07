import { resolveTeamId } from "../tenant/resolve.js";
import { getTenantAndSlackClient } from "../tenant/lookup.js";
import { processInsightsSignal } from "../insights/ingest.js";

export default function registerEvents(app) {
  console.log("📡 Events registered");

  app.message(async ({ message, context, body }) => {
    try {
      if (!message || message.bot_id || message.subtype) return;

      console.log("💬 Incoming message:", message.text);

      const teamId = resolveTeamId({ message, context, body });
      if (!teamId) return;

      const { tenant_id, slackClient } = await getTenantAndSlackClient({ teamId });
      console.log("🏢 Tenant resolved:", tenant_id);

      // 1. Fire insights
      console.log("🔬 Trigger insights...");
      processInsightsSignal(message, tenant_id);

      // 2. Call intervention function
      console.log("🎯 Calling slack-intervention...");
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

      console.log(`🎯 Intervention HTTP Status: ${interventionRes.status}`);
      const raw = await interventionRes.text();
      console.log(`🎯 Intervention Raw Response: ${raw}`);

      let intervention;
      try {
        intervention = JSON.parse(raw);
      } catch {
        console.error("❌ Failed to parse intervention JSON");
        return;
      }

      console.log("🎯 Intervention parsed:", intervention);

      if (!intervention.should_respond || !intervention.reply_text) {
        console.log("ℹ️ No intervention needed.");
        return;
      }

      const replyText = intervention.reply_text;
      const channel = message.channel;

      // Normalize respond_mode
      const respondMode = (intervention.respond_mode || "")
        .toLowerCase()
        .trim();

      // -------------------------------
      // EPHEMERAL RESPONSE
      // -------------------------------
      if (respondMode === "ephemeral") {
        console.log("🔎 Attempting ephemeral intervention…");

        try {
          const ephem = await slackClient.chat.postEphemeral({
            channel,
            user: message.user,
            text: replyText
          });

          console.log("🟢 Ephemeral success:", ephem);
          return;
        } catch (err) {
          console.error("❌ Ephemeral FAILED:", err.data || err);
          console.log("⚠️ Falling back to thread reply.");
        }

        // Fallback to thread reply
        await slackClient.chat.postMessage({
          channel,
          text: replyText,
          thread_ts: message.thread_ts || message.ts
        });

        console.log("🟢 Fallback thread reply sent.");
        return;
      }

      // -------------------------------
      // THREAD REPLY MODE
      // -------------------------------
      if (respondMode === "thread_reply") {
        console.log("💬 Sending thread-reply intervention…");

        await slackClient.chat.postMessage({
          channel,
          text: replyText,
          thread_ts: message.thread_ts || message.ts
        });

        console.log("🟢 Thread reply sent.");
        return;
      }

      // -------------------------------
      // CHANNEL MESSAGE MODE (default)
      // -------------------------------
      console.log("📣 Sending channel intervention…");

      await slackClient.chat.postMessage({
        channel,
        text: replyText
      });

      console.log("🟢 Channel message sent.");

    } catch (err) {
      console.error("❌ Message handler error:", err);
    }
  });
}
