import { describe, expect, it } from "vitest";
import {
  createUnavailableCaptionProvider,
  formatCaptionCues,
  parseJson3Captions,
} from "@/lib/jobs/materialPipelineCaptions";

describe("formatCaptionCues", () => {
  it("normalizes, sorts, and deduplicates caption cues before segment persistence", () => {
    const segments = formatCaptionCues([
      { startMs: 2000.4, endMs: 3000.2, text: "  Take   ownership  " },
      { startMs: 0, endMs: 900, text: "Move   forward" },
      { startMs: 2000, endMs: 3000, text: "Take ownership" },
      { startMs: 4000, endMs: 4000, text: "ignored" },
      { startMs: 5000, endMs: 5200, text: "   " },
    ]);

    expect(segments).toEqual([
      { id: "seg-0001", startMs: 0, endMs: 900, text: "Move forward" },
      { id: "seg-0002", startMs: 2000, endMs: 3000, text: "Take ownership" },
    ]);
  });
});

describe("parseJson3Captions", () => {
  it("extracts caption cues from json3 subtitle payloads", () => {
    expect(
      parseJson3Captions(
        JSON.stringify({
          events: [
            { tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: "Hello " }, { utf8: "world" }] },
            { tStartMs: 1300, dDurationMs: 800, segs: [{ utf8: "\nNext line" }] },
          ],
        }),
      ),
    ).toEqual([
      { startMs: 0, endMs: 1200, text: "Hello world" },
      { startMs: 1300, endMs: 2100, text: "Next line" },
    ]);
  });
});

describe("createUnavailableCaptionProvider", () => {
  it("returns an explicit unavailable result until a real YouTube captions fetcher is wired in", async () => {
    const provider = createUnavailableCaptionProvider();

    await expect(
      provider.fetchCaptions({
        materialId: "mat-1",
        youtubeId: "dQw4w9WgXcQ",
        youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    ).resolves.toEqual({
      status: "unavailable",
      source: "youtube_captions",
      reason: "captions_provider_not_configured",
      message: "YouTube captions provider is not configured yet.",
    });
  });
});
