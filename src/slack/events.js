import { resolveTeamId } from "../tenant/resolve.js";
import { getTenantAndSlackClient } from "../tenant/lookup.js";
import { processInsightsSignal } from "../insights/ingest.js";

export default function registerEvents(app) {
  console.log("📡 Events registered");

  app.message(async ({ message, context, body }) => {
    console.log("💬 Incoming message:", message.text);

    try {
      if (!message || message.bot_id || message.subtype) return;

      const teamId = resolveTeamId({ message, context, body });
      if (!teamId) return;

      const { tenant_id } = await getTenantAndSlackClient({ teamId });
      console.log("🏢 Tenant resolved:", tenant_id);

      console.log("🔬 Trigger insights...");
      processInsightsSignal(message, tenant_id);

    } catch (err) {
      console.error("❌ Message handler error:", err);
    }
  });
}
