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
      // 1. Existing: Insights ingestion (unchanged)
      // --------------------------------------------------
      processInsightsSignal(message, tenant_id);

      // --------------------------------------------------
      // 2. NEW: Human Answer Capture (STRICT fire-and-forget)
      // --------------------------------------------------
      (() => {
        try {
          const threadTs = message.thread_ts || message.ts;

          // Default: single-message fallback
          let threadMessages = [
            {
              user_id: message.user,
              text: message.text,
              timestamp: message.ts,
              is_bot: false
            }
          ];

          // Attempt to expand to full thread (best-effort only)
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
            .catch(() => {
              // Ignore — fallback already set
            })
            .finally(() => {
              // Fire-and-forget POST to Supabase Edge Function
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
              ).catch(() => {
                // Absolute silence: capture must never affect Slack
              });
            });
        } catch {
          // Absolute no-op
        }
      })();

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

// Build sources text from intervention response
let sourcesText = "";
if (intervention.sources && intervention.sources.length > 0) {
  const sourcesList = intervention.sources.map((s) => {
    return s.url ? `• <${s.url}|${s.title}>` : `• ${s.title}`;
  });
  sourcesText = `\n\n*Sources:*\n${sourcesList.join("\n")}`;
}

// Combine reply text with sources
const fullText = `${intervention.reply_text}${sourcesText}`;

const channel = message.channel;
const respondMode = (intervention.respond_mode || "").toLowerCase().trim();

if (respondMode === "ephemeral") {
  try {
    await slackClient.chat.postEphemeral({
      channel,
      user: message.user,
      text: fullText  // ✅ Now includes sources
    });
    return;
  } catch {
    // fall through
  }
}

if (respondMode === "thread_reply") {
  await slackClient.chat.postMessage({
    channel,
    text: fullText,  // ✅ Now includes sources
    thread_ts: message.thread_ts || message.ts
  });
  return;
}

await slackClient.chat.postMessage({
  channel,
  text: fullText  // ✅ Now includes sources
});

