import pkg from "@slack/bolt";
const { App, ExpressReceiver } = pkg;
import bodyParser from "body-parser";

import registerCommands from "./commands.js";
import registerEvents from "./events.js";
import registerFeedback from "./feedback.js";

export async function buildSlackApp() {
  console.log("📦 Building Slack App...");

  const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET
  });

  receiver.app.use(bodyParser.json());
  receiver.app.get("/health", (_req, res) => res.status(200).send("ok"));

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver,
    logLevel: "debug"   // FULL LOGGING
  });

  app.error((error) => {
    console.error("🔥 Global Slack App Error:", error);
  });

  registerCommands(app);
  registerEvents(app);
  registerFeedback(app);

  return app;
}
