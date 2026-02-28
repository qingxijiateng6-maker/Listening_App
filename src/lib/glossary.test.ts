import { describe, expect, it } from "vitest";
import { buildFallbackMeaningJa, glossaryHash, normalizeSurfaceText } from "@/lib/glossary";

describe("glossary helpers", () => {
  it("normalizes punctuation, whitespace, unicode variants, and casing", () => {
    expect(normalizeSurfaceText("  “Take   Ownership.”  ")).toBe("take ownership");
    expect(normalizeSurfaceText("Don’t")).toBe("don't");
    expect(normalizeSurfaceText("end - to - end")).toBe("end-to-end");
    expect(normalizeSurfaceText("  FULLWIDTH　SPACE  ")).toBe("fullwidth space");
  });

  it("deduplicates cache hashes for equivalent surface text variants", () => {
    expect(glossaryHash(" take ownership ")).toBe(glossaryHash("“Take   Ownership.”"));
    expect(glossaryHash("don’t")).toBe(glossaryHash("Don't"));
  });

  it("returns a slightly more informative fallback meaning", () => {
    expect(buildFallbackMeaningJa("take ownership")).toBe(
      "「take ownership」はフレーズ表現で、文脈に応じて自然な訳し方が変わります。",
    );
    expect(buildFallbackMeaningJa("issue")).toBe(
      "「issue」は文脈によって意味や訳し方が変わる語です。",
    );
  });
});
