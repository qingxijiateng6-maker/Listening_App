import { describe, expect, it } from "vitest";
import {
  formatCaptionCues,
  parseCaptionPayload,
  parseJson3Captions,
  parseTimedTextXmlCaptions,
  parseTtmlCaptions,
  parseWebVttCaptions,
} from "@/lib/jobs/materialPipelineCaptions";

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
