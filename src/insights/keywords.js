export function extractKeywords(text) {
  if (!text) return [];

  const stop = new Set(["this","that","with","from","also","just","very"]);
  const freq = {};

  for (const w of text.toLowerCase().split(/\s+/)) {
    if (w.length > 3 && !stop.has(w)) freq[w] = (freq[w] || 0) + 1;
  }

  return Object.entries(freq)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,5)
    .map(([w]) => w);
}
