import fetch from "node-fetch";
import { WebClient } from "@slack/web-api";

export async function getTenantAndSlackClient({ teamId }) {
  console.log("🔍 Tenant lookup for:", teamId);

  const res = await fetch(process.env.SLACK_TENANT_LOOKUP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_ANON_KEY,
      "x-internal-token": process.env.INTERNAL_LOOKUP_SECRET
    },
    body: JSON.stringify({ slack_team_id: teamId })
  });

  const data = await res.json();
  console.log("🏢 Tenant lookup response:", data);

  const token = data.slack_bot_token || process.env.SLACK_BOT_TOKEN;
  return { tenant_id: data.tenant_id, slackClient: new WebClient(token) };
}
