import { sanitizeText } from "./sanitize.js";
import { classifySentiment } from "./sentiment.js";
import { extractKeywords } from "./keywords.js";
import { isEligibleForInsights } from "./eligible.js";
import { hashMessage } from "./hash.js";

export async function processInsightsSignal(message, tenantId) {
  try {
    console.log("🔬 Insights: checking eligibility...");

    if (!isEligibleForInsights(message)) {
      console.log("🔬 Not eligible for insights");
      return;
    }

    const sanitized = sanitizeText(message.text || "");
    console.log("🔬 Sanitized:", sanitized);

    const sentiment = classifySentiment(sanitized);
    console.log("🔬 Sentiment:", sentiment);

    const keywords = extractKeywords(sanitized);
    console.log("🔬 Keywords:", keywords);

    await fetch(`${process.env.SUPABASE_URL}/functions/v1/insights-ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": process.env.INTERNAL_LOOKUP_SECRET
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        sanitized_text: sanitized,
        content_hash: hashMessage(sanitized),
        sentiment,
        keywords,
        source: "slack"
      })
    });

  } catch (err) {
    console.error("❌ Insights error:", err);
  }
}
