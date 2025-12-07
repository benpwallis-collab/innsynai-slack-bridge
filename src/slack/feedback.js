export default function registerFeedback(app) {
  console.log("📝 Feedback handlers registered");

  app.action("feedback_up", async ({ ack }) => {
    await ack();
    console.log("👍 Feedback up");
  });

  app.action("feedback_down", async ({ ack }) => {
    await ack();
    console.log("👎 Feedback down");
  });
}
