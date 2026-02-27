import { createHash } from "node:crypto";

export function normalizeSurfaceText(surfaceText: string): string {
  return surfaceText.trim().toLowerCase();
}

export function glossaryHash(surfaceText: string): string {
  const normalized = normalizeSurfaceText(surfaceText);
  return createHash("sha256").update(normalized).digest("hex");
}

export function buildFallbackMeaningJa(surfaceText: string): string {
  return `「${surfaceText}」の意味は文脈依存です。`;
}
