import { createHash } from "node:crypto";

const LEADING_OR_TRAILING_PUNCTUATION = /^[\s"'`“”‘’「」『』（）()［］\[\]{}<>.,!?;:]+|[\s"'`“”‘’「」『』（）()［］\[\]{}<>.,!?;:]+$/g;
const INNER_WHITESPACE = /\s+/g;
const SPACED_CONNECTORS = /\s*([/-])\s*/g;
const SPACED_APOSTROPHE = /\s*'\s*/g;

export function normalizeSurfaceText(surfaceText: string): string {
  return surfaceText
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .trim()
    .replace(LEADING_OR_TRAILING_PUNCTUATION, "")
    .replace(INNER_WHITESPACE, " ")
    .replace(SPACED_CONNECTORS, "$1")
    .replace(SPACED_APOSTROPHE, "'")
    .toLowerCase();
}

export function glossaryHash(surfaceText: string): string {
  const normalized = normalizeSurfaceText(surfaceText);
  return createHash("sha256").update(normalized).digest("hex");
}

export function buildFallbackMeaningJa(surfaceText: string): string {
  const normalized = normalizeSurfaceText(surfaceText);
  if (!normalized) {
    return "意味は文脈によって変わります。";
  }

  const isPhrase = normalized.includes(" ") || normalized.includes("-") || normalized.includes("/");
  if (isPhrase) {
    return `「${normalized}」はフレーズ表現で、文脈に応じて自然な訳し方が変わります。`;
  }

  return `「${normalized}」は文脈によって意味や訳し方が変わる語です。`;
}
