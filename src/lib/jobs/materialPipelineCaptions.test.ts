import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildYtDlpVideoInfoArgs,
  createUnavailableCaptionProvider,
  formatCaptionCues,
  parseCaptionPayload,
  parseJson3Captions,
  parseTtmlCaptions,
  parseWebVttCaptions,
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

  it("strips bom and html entities from json3 subtitle payloads", () => {
    expect(
      parseJson3Captions(
        `\uFEFF${JSON.stringify({
          events: [{ tStartMs: 0, dDurationMs: 700, segs: [{ utf8: "Tom &amp; Jerry" }] }],
        })}`,
      ),
    ).toEqual([{ startMs: 0, endMs: 700, text: "Tom & Jerry" }]);
  });
});

describe("parseWebVttCaptions", () => {
  it("parses vtt cues and drops malformed entries", () => {
    const cues = parseWebVttCaptions(`WEBVTT\n\n00:00:00.000 --> 00:00:01.200\nHello <c.colorE5E5E5>world</c>\n\ninvalid\n\n00:00:01.500 --> 00:00:02.300 align:start\nNext line\n`);

    expect(cues).toEqual([
      { startMs: 0, endMs: 1200, text: "Hello world" },
      { startMs: 1500, endMs: 2300, text: "Next line" },
    ]);
  });
});

describe("parseTtmlCaptions", () => {
  it("parses ttml cues", () => {
    const cues = parseTtmlCaptions(`<?xml version="1.0"?><tt><body><div><p begin="00:00:01.000" end="00:00:02.200">First<br/>line</p></div></body></tt>`);

    expect(cues).toEqual([{ startMs: 1000, endMs: 2200, text: "First line" }]);
  });
});

describe("parseCaptionPayload", () => {
  it("routes payload parsing by content type and extension", () => {
    expect(parseCaptionPayload("WEBVTT\n\n00:00:00.000 --> 00:00:00.500\nA", "text/vtt", "vtt")).toEqual([
      { startMs: 0, endMs: 500, text: "A" },
    ]);

    expect(parseCaptionPayload('{"events":[{"tStartMs":0,"dDurationMs":400,"segs":[{"utf8":"B"}]}]}', "application/json", "json3")).toEqual([
      { startMs: 0, endMs: 400, text: "B" },
    ]);
  });
});

describe("buildYtDlpVideoInfoArgs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requests subtitle tracks with fallback formats", () => {
    const args = buildYtDlpVideoInfoArgs("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(args).toContain("--write-subs");
    expect(args).toContain("--write-auto-subs");
    expect(args).toContain("--sub-langs");
    expect(args).toContain("--sub-format");
    expect(args).toContain("json3/srv3/vtt/ttml");
  });

  it("adds browser cookies when configured", () => {
    vi.stubEnv("YT_DLP_COOKIES_FROM_BROWSER", "chrome");

    const args = buildYtDlpVideoInfoArgs("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(args).toContain("--cookies-from-browser");
    expect(args).toContain("chrome");
  });

  it("prefers cookie file over browser cookies", () => {
    vi.stubEnv("YT_DLP_COOKIES_FROM_BROWSER", "chrome");
    vi.stubEnv("YT_DLP_COOKIES_PATH", "C:/tmp/youtube-cookies.txt");

    const args = buildYtDlpVideoInfoArgs("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(args).toContain("--cookies");
    expect(args).toContain("C:/tmp/youtube-cookies.txt");
    expect(args).not.toContain("--cookies-from-browser");
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
