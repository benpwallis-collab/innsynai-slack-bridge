export function sanitizeText(text) {
  if (!text) return "";

  return text
    .replace(/<@[\w]+>/g, " ")
    .replace(/<#[\w]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\w.+-]+@[\w.-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
