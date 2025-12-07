import { buildSlackApp } from "./src/slack/receiver.js";

const PORT = process.env.PORT || 3000;

(async () => {
  const app = await buildSlackApp();
  await app.start(PORT);
  console.log(`⚡ Slack bridge running on port ${PORT}`);
})();
