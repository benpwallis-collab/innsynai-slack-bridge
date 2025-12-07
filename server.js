// Ensure logs flush immediately on Render
process.stdout.write = process.stdout.write.bind(process.stdout);
process.stderr.write = process.stderr.write.bind(process.stderr);
console.log("🚀 Starting Slack Bridge (Render)...");
import { buildSlackApp } from "./src/slack/receiver.js";

const PORT = process.env.PORT || 3000;

(async () => {
  const app = await buildSlackApp();
  await app.start(PORT);
  console.log(`⚡ Slack bridge running on port ${PORT}`);
})();
