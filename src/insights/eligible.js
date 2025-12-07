export function isEligibleForInsights(message) {
  if (!message || message.bot_id) return false;
  if (!message.channel?.startsWith("C")) return false;

  const excluded = ["channel_join", "channel_leave", "file_share", "channel_topic"];
  if (excluded.includes(message.subtype)) return false;

  const text = message.text || "";
  if (text.trim().split(/\s+/).length < 4) return false;
  if (/^(:\w+:\s*)+$/.test(text.trim())) return false;

  return true;
}
