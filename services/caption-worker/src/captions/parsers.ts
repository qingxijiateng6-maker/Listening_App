import type { CaptionCue, FormattedSegment } from "./types.js";

type Json3Segment = {
  utf8?: string;
};

type Json3Event = {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Segment[];
};

type Json3Captions = {
  events?: Json3Event[];
};

const DEFAULT_MERGE_MAX_GAP_MS = 900;
const DEFAULT_MERGE_MAX_DURATION_MS = 7_000;
const DEFAULT_MERGE_MAX_TEXT_LENGTH = 220;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCharCode(Number.parseInt(value, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => String.fromCharCode(Number.parseInt(value, 16)));
}

function normalizeCaptionText(text: string): string {
  return decodeHtmlEntities(
    text
      .replace(/<[^>]+>/g, " ")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function parseTimestampToMs(raw: string): number | null {
  const value = raw.trim().replace(",", ".");
  if (!value) {
    return null;
  }

  const secondsMatch = value.match(/^(\d+(?:\.\d+)?)s$/i);
  if (secondsMatch) {
    const seconds = Number.parseFloat(secondsMatch[1] ?? "");
    return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : null;
  }

  const millisMatch = value.match(/^(\d+(?:\.\d+)?)ms$/i);
  if (millisMatch) {
    const millis = Number.parseFloat(millisMatch[1] ?? "");
    return Number.isFinite(millis) ? Math.max(0, Math.round(millis)) : null;
  }

  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  const secondsPart = parts[parts.length - 1] ?? "0";
  const minutesPart = parts[parts.length - 2] ?? "0";
  const hoursPart = parts.length === 3 ? (parts[0] ?? "0") : "0";

  const seconds = Number.parseFloat(secondsPart);
  const minutes = Number.parseInt(minutesPart, 10);
  const hours = Number.parseInt(hoursPart, 10);
  if (!Number.isFinite(seconds) || !Number.isFinite(minutes) || !Number.isFinite(hours)) {
    return null;
  }

  return Math.max(0, Math.round((hours * 3600 + minutes * 60 + seconds) * 1000));
}

function parseTimedTextSeconds(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 1000);
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function buildSegmentId(index: number): string {
  return `seg-${String(index + 1).padStart(4, "0")}`;
}

function joinCaptionTexts(left: string, right: string): string {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  const needsSpace = !/[([\s"']$/.test(left) && !/^[\s,.;!?)]/.test(right);
  return normalizeCaptionText(`${left}${needsSpace ? " " : ""}${right}`);
}

function endsSentence(text: string): boolean {
  return /(?:[.!?]|[。！？]|…|\.{2,})["')\]]*\s*$/.test(text);
}

export function parseJson3Captions(rawJson: string): CaptionCue[] {
  const parsed = JSON.parse(stripBom(rawJson)) as Json3Captions;
  const events = parsed.events ?? [];
  const cues: CaptionCue[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event) {
      continue;
    }

    let text = "";
    for (const segment of event.segs ?? []) {
      text += segment.utf8 ?? "";
    }

    text = normalizeCaptionText(text.replace(/\r/g, " ").replace(/\n/g, " "));
    if (!text) {
      continue;
    }

    const startMs = Math.max(0, Math.round(event.tStartMs ?? 0));
    let durationMs = Math.max(0, Math.round(event.dDurationMs ?? 0));
    if (durationMs <= 0) {
      const nextStartMs = events[index + 1]?.tStartMs;
      if (typeof nextStartMs === "number" && nextStartMs > startMs) {
        durationMs = Math.round(nextStartMs - startMs);
      }
    }

    if (durationMs <= 0) {
      continue;
    }

    cues.push({
      startMs,
      endMs: startMs + durationMs,
      text,
    });
  }

  return cues;
}

export function parseWebVttCaptions(rawVtt: string): CaptionCue[] {
  const lines = stripBom(rawVtt).replace(/\r/g, "").split("\n");
  const cues: CaptionCue[] = [];

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    let line = lines[lineIndex]?.trim() ?? "";
    if (!line || line.startsWith("WEBVTT") || line.startsWith("NOTE") || line === "STYLE" || line === "REGION") {
      lineIndex += 1;
      continue;
    }

    if (!line.includes("-->")) {
      lineIndex += 1;
      line = lines[lineIndex]?.trim() ?? "";
    }

    if (!line.includes("-->")) {
      lineIndex += 1;
      continue;
    }

    const [startRaw, endRawWithSettings = ""] = line.split("-->");
    const startMs = parseTimestampToMs(startRaw);
    const endMs = parseTimestampToMs(endRawWithSettings.trim().split(/\s+/)[0] ?? "");

    lineIndex += 1;
    const textLines: string[] = [];
    while (lineIndex < lines.length && (lines[lineIndex] ?? "").trim().length > 0) {
      textLines.push(lines[lineIndex] ?? "");
      lineIndex += 1;
    }

    if (startMs !== null && endMs !== null && endMs > startMs) {
      const text = normalizeCaptionText(textLines.join(" "));
      if (text) {
        cues.push({ startMs, endMs, text });
      }
    }

    lineIndex += 1;
  }

  return cues;
}

export function parseTtmlCaptions(rawTtml: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const content = stripBom(rawTtml);
  const nodePattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let match = nodePattern.exec(content);

  while (match) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const beginMatch = attrs.match(/\bbegin="([^"]+)"/i);
    const endMatch = attrs.match(/\bend="([^"]+)"/i);
    const durMatch = attrs.match(/\bdur="([^"]+)"/i);

    const startMs = beginMatch ? parseTimestampToMs(beginMatch[1] ?? "") : null;
    const endMs = endMatch
      ? parseTimestampToMs(endMatch[1] ?? "")
      : durMatch && startMs !== null
        ? startMs + (parseTimestampToMs(durMatch[1] ?? "") ?? 0)
        : null;

    const text = normalizeCaptionText(body.replace(/<br\s*\/?>/gi, " "));
    if (startMs !== null && endMs !== null && endMs > startMs && text) {
      cues.push({ startMs, endMs, text });
    }

    match = nodePattern.exec(content);
  }

  return cues;
}

export function parseTimedTextXmlCaptions(rawXml: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const content = stripBom(rawXml);
  const nodePattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let match = nodePattern.exec(content);

  while (match) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const startMatch = attrs.match(/\bstart="([^"]+)"/i);
    const durMatch = attrs.match(/\bdur="([^"]+)"/i);
    const startMs = parseTimedTextSeconds(startMatch?.[1]);
    const durationMs = parseTimedTextSeconds(durMatch?.[1]);
    const text = normalizeCaptionText(body);

    if (startMs !== null && durationMs !== null && durationMs > 0 && text) {
      cues.push({
        startMs,
        endMs: startMs + durationMs,
        text,
      });
    }

    match = nodePattern.exec(content);
  }

  return cues;
}

export function parseSrtCaptions(rawSrt: string): CaptionCue[] {
  return parseWebVttCaptions(stripBom(rawSrt).replace(/\n\d+\n/g, "\n"));
}

export function parseCaptionPayload(rawText: string, extensionHint: string | undefined): CaptionCue[] {
  const normalizedExtension = (extensionHint ?? "").toLowerCase();
  const trimmed = rawText.trimStart();

  if (normalizedExtension === "json3" || trimmed.startsWith("{")) {
    return parseJson3Captions(rawText);
  }
  if (
    normalizedExtension === "srv1" ||
    normalizedExtension === "srv2" ||
    normalizedExtension === "srv3" ||
    trimmed.startsWith("<transcript") ||
    trimmed.startsWith("<text")
  ) {
    return parseTimedTextXmlCaptions(rawText);
  }
  if (normalizedExtension === "ttml" || trimmed.startsWith("<?xml") || trimmed.startsWith("<tt")) {
    return parseTtmlCaptions(rawText);
  }
  if (normalizedExtension === "srt") {
    return parseSrtCaptions(rawText);
  }
  return parseWebVttCaptions(rawText);
}

export function formatCaptionCues(cues: CaptionCue[]): FormattedSegment[] {
  const normalized = cues
    .map((cue) => ({
      startMs: Math.max(0, Math.round(cue.startMs)),
      endMs: Math.max(0, Math.round(cue.endMs)),
      text: normalizeCaptionText(cue.text),
    }))
    .filter((cue) => cue.text.length > 0 && cue.endMs > cue.startMs)
    .sort((left, right) => {
      if (left.startMs !== right.startMs) {
        return left.startMs - right.startMs;
      }
      if (left.endMs !== right.endMs) {
        return left.endMs - right.endMs;
      }
      return compareText(left.text, right.text);
    });

  const segments: FormattedSegment[] = [];
  let current: { startMs: number; endMs: number; text: string } | null = null;
  let previous: { startMs: number; endMs: number; text: string } | null = null;

  const flushCurrent = () => {
    if (!current) {
      return;
    }

    segments.push({
      id: buildSegmentId(segments.length),
      startMs: current.startMs,
      endMs: current.endMs,
      text: current.text,
    });
    current = null;
  };

  for (const cue of normalized) {
    if (
      previous &&
      previous.startMs === cue.startMs &&
      previous.endMs === cue.endMs &&
      previous.text === cue.text
    ) {
      continue;
    }
    previous = cue;

    if (!current) {
      current = { ...cue };
      continue;
    }

    const gapMs = Math.max(0, cue.startMs - current.endMs);
    const mergedEndMs = Math.max(current.endMs, cue.endMs);
    const mergedDurationMs = mergedEndMs - current.startMs;
    const mergedText = joinCaptionTexts(current.text, cue.text);

    const shouldMerge =
      gapMs <= DEFAULT_MERGE_MAX_GAP_MS &&
      mergedDurationMs <= DEFAULT_MERGE_MAX_DURATION_MS &&
      mergedText.length <= DEFAULT_MERGE_MAX_TEXT_LENGTH &&
      !endsSentence(current.text);

    if (!shouldMerge) {
      flushCurrent();
      current = { ...cue };
      continue;
    }

    current.endMs = mergedEndMs;
    current.text = mergedText;
  }

  flushCurrent();
  return segments;
}
