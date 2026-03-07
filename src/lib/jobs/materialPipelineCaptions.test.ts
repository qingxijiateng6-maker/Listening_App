import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTimedTextCaptionProvider,
  createUnavailableCaptionProvider,
  formatCaptionCues,
  getMaterialPipelineCaptionProvider,
  parseCaptionPayload,
  parseJson3Captions,
  parseTimedTextXmlCaptions,
  parseTtmlCaptions,
  parseWebVttCaptions,
} from "@/lib/jobs/materialPipelineCaptions";

function textResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, init);
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    status: init?.status,
    statusText: init?.statusText,
  });
}

describe("formatCaptionCues", () => {
  it("normalizes, deduplicates, and merges nearby cues until a sentence boundary", () => {
    const segments = formatCaptionCues([
      { startMs: 0, endMs: 900, text: "Move   forward" },
      { startMs: 1000, endMs: 1700, text: "together" },
      { startMs: 1800, endMs: 2600, text: "  Done. " },
      { startMs: 1800, endMs: 2600, text: "Done." },
      { startMs: 3000, endMs: 3600, text: "Next" },
      { startMs: 3900, endMs: 4500, text: "segment" },
      { startMs: 3900, endMs: 4500, text: "segment" },
      { startMs: 5000, endMs: 5000, text: "ignored" },
    ]);

    expect(segments).toEqual([
      { id: "seg-0001", startMs: 0, endMs: 2600, text: "Move forward together Done." },
      { id: "seg-0002", startMs: 3000, endMs: 4500, text: "Next segment" },
    ]);
  });

  it("stops merging when gap, duration, or text length limits are exceeded", () => {
    const longText = "x".repeat(216);

    const segments = formatCaptionCues([
      { startMs: 0, endMs: 2800, text: "Alpha" },
      { startMs: 3000, endMs: 6200, text: "Beta" },
      { startMs: 6500, endMs: 7600, text: "Gamma" },
      { startMs: 8800, endMs: 9300, text: "Delta" },
      { startMs: 9500, endMs: 10100, text: longText },
      { startMs: 10200, endMs: 10700, text: "tail" },
    ]);

    expect(segments).toEqual([
      { id: "seg-0001", startMs: 0, endMs: 6200, text: "Alpha Beta" },
      { id: "seg-0002", startMs: 6500, endMs: 7600, text: "Gamma" },
      { id: "seg-0003", startMs: 8800, endMs: 9300, text: "Delta" },
      { id: "seg-0004", startMs: 9500, endMs: 10100, text: longText },
      { id: "seg-0005", startMs: 10200, endMs: 10700, text: "tail" },
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

  it("infers duration from the next event when json3 omits dDurationMs", () => {
    expect(
      parseJson3Captions(
        JSON.stringify({
          events: [
            { tStartMs: 0, segs: [{ utf8: "Hello" }] },
            { tStartMs: 900, dDurationMs: 600, segs: [{ utf8: "world" }] },
          ],
        }),
      ),
    ).toEqual([
      { startMs: 0, endMs: 900, text: "Hello" },
      { startMs: 900, endMs: 1500, text: "world" },
    ]);
  });
});

describe("parseWebVttCaptions", () => {
  it("parses vtt cues and drops malformed entries", () => {
    const cues = parseWebVttCaptions(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.200\nHello <c.colorE5E5E5>world</c>\n\ninvalid\n\n00:00:01.500 --> 00:00:02.300 align:start\nNext line\n",
    );

    expect(cues).toEqual([
      { startMs: 0, endMs: 1200, text: "Hello world" },
      { startMs: 1500, endMs: 2300, text: "Next line" },
    ]);
  });
});

describe("parseTtmlCaptions", () => {
  it("parses ttml cues", () => {
    const cues = parseTtmlCaptions(
      '<?xml version="1.0"?><tt><body><div><p begin="00:00:01.000" end="00:00:02.200">First<br/>line</p></div></body></tt>',
    );

    expect(cues).toEqual([{ startMs: 1000, endMs: 2200, text: "First line" }]);
  });
});

describe("parseTimedTextXmlCaptions", () => {
  it("parses legacy timedtext xml transcript payloads", () => {
    expect(
      parseTimedTextXmlCaptions(
        '<transcript><text start="1.5" dur="0.8">Tom &amp; Jerry</text><text start="2.5" dur="0.7">Next</text></transcript>',
      ),
    ).toEqual([
      { startMs: 1500, endMs: 2300, text: "Tom & Jerry" },
      { startMs: 2500, endMs: 3200, text: "Next" },
    ]);
  });
});

describe("parseCaptionPayload", () => {
  it("routes payload parsing by content type and extension", () => {
    expect(parseCaptionPayload("WEBVTT\n\n00:00:00.000 --> 00:00:00.500\nA", "text/vtt", "vtt")).toEqual([
      { startMs: 0, endMs: 500, text: "A" },
    ]);

    expect(
      parseCaptionPayload(
        '{"events":[{"tStartMs":0,"dDurationMs":400,"segs":[{"utf8":"B"}]}]}',
        "application/json",
        "json3",
      ),
    ).toEqual([{ startMs: 0, endMs: 400, text: "B" }]);

    expect(
      parseCaptionPayload('<transcript><text start="0.0" dur="0.5">C</text></transcript>', "application/xml"),
    ).toEqual([{ startMs: 0, endMs: 500, text: "C" }]);
  });
});

describe("caption provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches captions via watch html, innertube player, and fmt=json3", async () => {
    const fetchMock = vi.fn<
      typeof fetch
    >();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        textResponse('<html>"INNERTUBE_API_KEY":"api-key","VISITOR_DATA":"visitor-token"</html>'),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          videoDetails: {
            title: "Deep Listening",
            author: "Open Channel",
            lengthSeconds: "7200",
          },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl: "https://www.youtube.com/api/timedtext?v=abc123&lang=en",
                  languageCode: "en",
                  name: { simpleText: "English" },
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        textResponse(
          JSON.stringify({
            events: [{ tStartMs: 0, dDurationMs: 900, segs: [{ utf8: "hello world" }] }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    const provider = createTimedTextCaptionProvider();
    const result = await provider.fetchCaptions({
      materialId: "mat-1",
      youtubeId: "abc123",
      youtubeUrl: "https://www.youtube.com/watch?v=abc123",
    });

    expect(result).toEqual({
      status: "fetched",
      source: "youtube_captions",
      cues: [{ startMs: 0, endMs: 900, text: "hello world" }],
      metadata: {
        title: "Deep Listening",
        channel: "Open Channel",
        durationSec: 7200,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/youtubei/v1/player?key=api-key");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("fmt=json3");

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body.videoId).toBe("abc123");
  });

  it("falls back to the iOS innertube client when Android returns no caption tracks", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        textResponse('<html>"INNERTUBE_API_KEY":"api-key","VISITOR_DATA":"visitor-token"</html>'),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          videoDetails: {
            title: "Android Miss",
            author: "Open Channel",
            lengthSeconds: "7200",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          videoDetails: {
            title: "iOS Hit",
            author: "Open Channel",
            lengthSeconds: "7200",
          },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl: "https://www.youtube.com/api/timedtext?v=abc123&lang=en",
                  languageCode: "en",
                  name: { simpleText: "English" },
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        textResponse(
          JSON.stringify({
            events: [{ tStartMs: 0, dDurationMs: 900, segs: [{ utf8: "ios fallback cue" }] }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    const provider = createTimedTextCaptionProvider();
    const result = await provider.fetchCaptions({
      materialId: "mat-ios",
      youtubeId: "abc123",
      youtubeUrl: "https://www.youtube.com/watch?v=abc123",
    });

    expect(result).toEqual({
      status: "fetched",
      source: "youtube_captions",
      cues: [{ startMs: 0, endMs: 900, text: "ios fallback cue" }],
      metadata: {
        title: "iOS Hit",
        channel: "Open Channel",
        durationSec: 7200,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      "x-youtube-client-name": "3",
    });
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      "x-youtube-client-name": "5",
    });
  });

  it("falls back to ytInitialPlayerResponse parsing when innertube is unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        textResponse(
          `<html><script>var ytInitialPlayerResponse = ${JSON.stringify({
            videoDetails: {
              title: "Fallback Video",
              author: "Fallback Channel",
              lengthSeconds: "42",
            },
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: [
                  {
                    baseUrl: "https://www.youtube.com/api/timedtext?v=fallback&lang=en",
                    languageCode: "en",
                    name: { simpleText: "English" },
                  },
                ],
              },
            },
          })};</script></html>`,
        ),
      )
      .mockResolvedValueOnce(
        textResponse(
          JSON.stringify({
            events: [{ tStartMs: 0, dDurationMs: 500, segs: [{ utf8: "fallback cue" }] }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    const provider = getMaterialPipelineCaptionProvider();
    const result = await provider.fetchCaptions({
      materialId: "mat-2",
      youtubeId: "fallback",
      youtubeUrl: "https://www.youtube.com/watch?v=fallback",
    });

    expect(result).toEqual({
      status: "fetched",
      source: "youtube_captions",
      cues: [{ startMs: 0, endMs: 500, text: "fallback cue" }],
      metadata: {
        title: "Fallback Video",
        channel: "Fallback Channel",
        durationSec: 42,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("fmt=json3");
  });

  it("tries the next ranked caption track when the first track does not yield usable cues", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        textResponse(
          `<html><script>var ytInitialPlayerResponse = ${JSON.stringify({
            videoDetails: {
              title: "Track Fallback",
              author: "Fallback Channel",
              lengthSeconds: "42",
            },
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: [
                  {
                    baseUrl: "https://www.youtube.com/api/timedtext?v=fallback&lang=en&kind=asr",
                    languageCode: "en",
                    kind: "asr",
                    name: { simpleText: "English (auto-generated)" },
                  },
                  {
                    baseUrl: "https://www.youtube.com/api/timedtext?v=fallback&lang=en",
                    languageCode: "en",
                    name: { simpleText: "English" },
                  },
                ],
              },
            },
          })};</script></html>`,
        ),
      )
      .mockResolvedValueOnce(textResponse('{"events":[]}', { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(textResponse("WEBVTT\n\n", { headers: { "content-type": "text/vtt" } }))
      .mockResolvedValueOnce(
        textResponse(
          JSON.stringify({
            events: [{ tStartMs: 0, dDurationMs: 500, segs: [{ utf8: "fallback cue" }] }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    const provider = getMaterialPipelineCaptionProvider();
    const result = await provider.fetchCaptions({
      materialId: "mat-4",
      youtubeId: "fallback",
      youtubeUrl: "https://www.youtube.com/watch?v=fallback",
    });

    expect(result).toEqual({
      status: "fetched",
      source: "youtube_captions",
      cues: [{ startMs: 0, endMs: 500, text: "fallback cue" }],
      metadata: {
        title: "Track Fallback",
        channel: "Fallback Channel",
        durationSec: 42,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("lang=en");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("lang=en");
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("lang=en&kind=asr");
  });

  it("returns captions_not_found when the video exposes no caption tracks", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const noCaptionBody = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify({
      videoDetails: {
        title: "No Captions",
        author: "Silent Channel",
        lengthSeconds: "60",
      },
    })};</script></html>`;
    fetchMock
      .mockResolvedValueOnce(textResponse(noCaptionBody))
      .mockResolvedValueOnce(textResponse(noCaptionBody))
      .mockResolvedValueOnce(textResponse(noCaptionBody))
      .mockResolvedValueOnce(textResponse(noCaptionBody));

    const provider = getMaterialPipelineCaptionProvider();
    await expect(
      provider.fetchCaptions({
        materialId: "mat-3",
        youtubeId: "nocaptions",
        youtubeUrl: "https://www.youtube.com/watch?v=nocaptions",
      }),
    ).resolves.toEqual({
      status: "unavailable",
      source: "youtube_captions",
      reason: "captions_not_found",
      message: "No YouTube captions were available for this video.",
    });
  });

  it("falls back to the embed page when watch variants expose no caption tracks", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock
      .mockResolvedValueOnce(textResponse("<html><body>No caption tracks here.</body></html>"))
      .mockResolvedValueOnce(textResponse("<html><body>No caption tracks here.</body></html>"))
      .mockResolvedValueOnce(
        textResponse(
          `<html><script>var ytInitialPlayerResponse = ${JSON.stringify({
            videoDetails: {
              title: "Embed Captions",
              author: "Embed Channel",
              lengthSeconds: "120",
            },
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: [
                  {
                    baseUrl: "https://www.youtube.com/api/timedtext?v=embed123&lang=en",
                    languageCode: "en",
                    name: { simpleText: "English" },
                  },
                ],
              },
            },
          })};</script></html>`,
        ),
      )
      .mockResolvedValueOnce(
        textResponse(
          JSON.stringify({
            events: [{ tStartMs: 0, dDurationMs: 800, segs: [{ utf8: "embed fallback cue" }] }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    const provider = getMaterialPipelineCaptionProvider();
    const result = await provider.fetchCaptions({
      materialId: "mat-5",
      youtubeId: "embed123",
      youtubeUrl: "https://www.youtube.com/watch?v=embed123",
    });

    expect(result).toEqual({
      status: "fetched",
      source: "youtube_captions",
      cues: [{ startMs: 0, endMs: 800, text: "embed fallback cue" }],
      metadata: {
        title: "Embed Captions",
        channel: "Embed Channel",
        durationSec: 120,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("youtube.com/watch");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("m.youtube.com/watch");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/embed/embed123");
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("fmt=json3");
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
