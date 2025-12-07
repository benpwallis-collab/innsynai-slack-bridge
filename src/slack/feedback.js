export default function registerFeedback(app) {
  app.action("feedback_up", async ({ ack }) => {
    await ack();
  });
  app.action("feedback_down", async ({ ack }) => {
    await ack();
  });
}
