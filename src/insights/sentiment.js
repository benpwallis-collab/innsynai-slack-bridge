export function classifySentiment(text) {
  if (!text) return { primary: "neutral", labels: [] };

  const tokens = text.toLowerCase().split(/\s+/);

  const WORDS = {
    positive: { great:2, excellent:3, love:3, amazing:3, helpful:1 },
    negative: { bad:2, terrible:3, awful:3, frustrated:2, angry:2 },
    burnout: { exhausted:3, overwhelmed:3, stressed:2 },
    attrition: { quit:3, resign:3, leaving:2 },
    conflict: { fight:2, hostile:3 },
    workload: { overloaded:2, urgent:1 },
    tooling: { slow:1, buggy:1 }
  };

  let pos = 0, neg = 0;
  const labels = new Set();

  for (const t of tokens) {
    if (WORDS.positive[t]) pos += WORDS.positive[t];
    if (WORDS.negative[t]) neg += WORDS.negative[t];

    if (WORDS.burnout[t]) labels.add("burnout_risk");
    if (WORDS.attrition[t]) labels.add("attrition_risk");
    if (WORDS.conflict[t]) labels.add("conflict_risk");
    if (WORDS.workload[t]) labels.add("workload_pressure");
    if (WORDS.tooling[t]) labels.add("tooling_frustration");
  }

  let primary = "neutral";
  if (neg > pos) primary = "negative";
  else if (pos > neg) primary = "positive";

  return { primary, labels: [...labels] };
}
