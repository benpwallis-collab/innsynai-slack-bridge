import fetch from "node-fetch";
import { WebClient } from "@slack/web-api";

export async function getTenantAndSlackClient({ teamId }) {
  const res = await fetch(process.env.SLACK_TENANT_LOOKUP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_ANON_KEY,
      "x-internal-token": process.env.INTERNAL_LOOKUP_SECRET
    },
    body: JSON.stringify({ slack_team_id: teamId })
  });

  if (!res.ok) {
    console.error("Tenant lookup failed:", await res.text());
    throw new Error("Tenant lookup failed");
  }

  const { tenant_id, slack_bot_token } = await res.json();
  const token = slack_bot_token || process.env.SLACK_BOT_TOKEN;

  return { tenant_id, slackClient: new WebClient(token) };
}
