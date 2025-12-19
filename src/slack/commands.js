import { resolveTeamId } from "../tenant/resolve.js";
import { getTenantAndSlackClient } from "../tenant/lookup.js";
import { formatAnswerBlocks } from "../helpers/formatting.js";

export default function registerCommands(app) {
  console.log("📘 Commands registered");

  app.command("/ask", async ({ command, ack, respond, context, body }) => {
    console.log("➡️ /ask received:", command.text);
    await ack();

    const teamId = resolveTeamId({ command, context, body });

    if (!teamId) {
      await respond("❌ Could not determine workspace.");
      return;
    }

 //   await respond("⚙️ Working on it...");

    try {
      const { tenant_id } = await getTenantAndSlackClient({ teamId });

      const ragRes = await fetch(process.env.RAG_QUERY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.SUPABASE_ANON_KEY,
          "x-tenant-id": tenant_id
        },
        body: JSON.stringify({
          question: command.text,
          source: "slack"
        })
      });

      const data = await ragRes.json();

      console.log("⬅️ /ask responding with:", data.answer);

      await respond({
        blocks: formatAnswerBlocks(
          command.text,
          data.answer,
          data.sources,
          data.qa_log_id
        ),
        text: data.answer
      });

    } catch (err) {
      console.error("❌ /ask error:", err);
      await respond("❌ Something went wrong.");
    }
  });
}
