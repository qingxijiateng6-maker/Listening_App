export type CaptionCue = {
  startMs: number;
  endMs: number;
  text: string;
};

export type CaptionProviderInput = {
  materialId: string;
  youtubeId: string;
  youtubeUrl: string;
};

type CaptionMetadata = {
  title?: string;
  channel?: string;
  durationSec?: number;
};

export type CaptionFetchResult =
  | {
      status: "fetched";
      source: "youtube_captions";
      cues: CaptionCue[];
      metadata?: CaptionMetadata;
    }
  | {
      status: "unavailable";
      source: "youtube_captions";
      reason:
        | "captions_not_found"
        | "captions_provider_not_configured"
        | "captions_provider_failed";
      message: string;
    };

export type CaptionProvider = {
  fetchCaptions(input: CaptionProviderInput): Promise<CaptionFetchResult>;
};

export type FormattedSegment = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
};

type CommandInvocation = {
  command: string;
  args: string[];
};

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

type WatchPageCaptionTrack = {
  baseUrl: string;
  languageCode: string;
  languageName: string;
  kind?: string;
  name?: string;
  vssId?: string;
};

type WatchPagePlayerResponse = {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{
        baseUrl?: string;
        languageCode?: string;
        kind?: string;
        vssId?: string;
        name?: {
          simpleText?: string;
          runs?: Array<{
            text?: string;
          }>;
        };
      }>;
    };
  };
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string;
  };
};

type InnertubeContext = {
  apiKey?: string;
  visitorData?: string;
};

const DEFAULT_CAPTION_FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_CAPTION_FETCH_RETRIES = 1;
const MAX_CAPTION_PAYLOAD_BYTES = 16 * 1024 * 1024;
const DEFAULT_SUBTITLE_LANGS = "en.*,en";
const DEFAULT_ANDROID_INNERTUBE_CLIENT_NAME = "3";
const DEFAULT_ANDROID_INNERTUBE_CLIENT_VERSION = "21.02.35";
const DEFAULT_ANDROID_INNERTUBE_USER_AGENT =
  "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip";
const DEFAULT_WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const DEFAULT_MOBILE_WEB_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1";
const DEFAULT_MERGE_MAX_GAP_MS = 900;
const DEFAULT_MERGE_MAX_DURATION_MS = 7_000;
const DEFAULT_MERGE_MAX_TEXT_LENGTH = 220;

function readEnvString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readEnvInt(name: string, fallback: number): number {
  const value = readEnvString(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function getCaptionFetchTimeoutMs(): number {
  return (
    readEnvInt("YT_CAPTION_FETCH_TIMEOUT_MS", 0) ||
    readEnvInt("YT_DLP_CAPTION_FETCH_TIMEOUT_MS", 0) ||
    readEnvInt("YT_DLP_TIMEOUT_MS", DEFAULT_CAPTION_FETCH_TIMEOUT_MS)
  );
}

function getCaptionFetchRetries(): number {
  return (
    readEnvInt("YT_CAPTION_FETCH_RETRIES", 0) ||
    readEnvInt("YT_DLP_CAPTION_FETCH_RETRIES", 0) ||
    readEnvInt("YT_DLP_RETRIES", DEFAULT_CAPTION_FETCH_RETRIES)
  );
}

function getPreferredSubtitleLangs(): string {
  return readEnvString("YT_SUB_LANGS") ?? readEnvString("YT_DLP_SUB_LANGS") ?? DEFAULT_SUBTITLE_LANGS;
}

function getWebUserAgent(): string {
  return readEnvString("YT_CAPTION_USER_AGENT") ?? readEnvString("YT_DLP_USER_AGENT") ?? DEFAULT_WEB_USER_AGENT;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
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

function buildRequestHeaders(options?: {
  userAgent?: string;
  referer?: string;
  extra?: Record<string, string | undefined>;
}): HeadersInit {
  const headers: Record<string, string> = {
    "accept-language": "en-US,en;q=0.9",
    "user-agent": options?.userAgent ?? getWebUserAgent(),
  };

  if (options?.referer) {
    headers.referer = options.referer;
  }

  for (const [key, value] of Object.entries(options?.extra ?? {})) {
    if (value) {
      headers[key] = value;
    }
  }

  return headers;
}

function buildSegmentId(index: number): string {
  return `seg-${String(index + 1).padStart(4, "0")}`;
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

function resolveLanguagePriority(languageCode: string): number {
  const patterns = getPreferredSubtitleLangs()
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const exactIndex = patterns.findIndex((pattern) => !pattern.endsWith(".*") && pattern === languageCode);
  if (exactIndex >= 0) {
    return exactIndex;
  }

  const prefixIndex = patterns.findIndex(
    (pattern) => pattern.endsWith(".*") && languageCode.startsWith(pattern.slice(0, -1)),
  );
  return prefixIndex >= 0 ? prefixIndex : Number.MAX_SAFE_INTEGER;
}

function parseTrackName(
  name:
    | {
        simpleText?: string;
        runs?: Array<{
          text?: string;
        }>;
      }
    | undefined,
): string | undefined {
  const simpleText = name?.simpleText?.trim();
  if (simpleText) {
    return simpleText;
  }

  const text = name?.runs?.map((run) => run.text ?? "").join("").trim();
  return text || undefined;
}

function normalizeTrackDisplayName(track: WatchPageCaptionTrack): string {
  const name = track.name?.trim();
  if (name) {
    return name;
  }

  return track.kind === "asr" ? `${track.languageName} (auto-generated)` : track.languageName;
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function rankWatchPageCaptionTracks(tracks: WatchPageCaptionTrack[]): WatchPageCaptionTrack[] {
  const rankedTracks = [...tracks];
  rankedTracks.sort((left, right) => {
    const languageDiff = resolveLanguagePriority(left.languageCode) - resolveLanguagePriority(right.languageCode);
    if (languageDiff !== 0) {
      return languageDiff;
    }

    const kindDiff = Number(left.kind === "asr") - Number(right.kind === "asr");
    if (kindDiff !== 0) {
      return kindDiff;
    }

    const originalDiff =
      Number(!normalizeTrackDisplayName(left).includes("Original")) -
      Number(!normalizeTrackDisplayName(right).includes("Original"));
    if (originalDiff !== 0) {
      return originalDiff;
    }

    return compareText(left.languageCode, right.languageCode);
  });

  return rankedTracks;
}

function parseLengthSeconds(raw: string | undefined): number | undefined {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function toWatchPageMetadata(playerResponse: WatchPagePlayerResponse): CaptionMetadata {
  return {
    title: playerResponse.videoDetails?.title?.trim() || undefined,
    channel: playerResponse.videoDetails?.author?.trim() || undefined,
    durationSec: parseLengthSeconds(playerResponse.videoDetails?.lengthSeconds),
  };
}

function extractCaptionTracksFromPlayerResponse(playerResponse: WatchPagePlayerResponse): WatchPageCaptionTrack[] {
  const captionTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const tracks: WatchPageCaptionTrack[] = [];

  for (const track of captionTracks) {
    const baseUrl = track.baseUrl?.trim() ?? "";
    const languageCode = track.languageCode?.trim() ?? "";
    if (!baseUrl || !languageCode) {
      continue;
    }

    const languageName = parseTrackName(track.name) ?? languageCode;
    tracks.push({
      baseUrl,
      languageCode,
      languageName,
      kind: track.kind?.trim() || undefined,
      name: parseTrackName(track.name),
      vssId: track.vssId?.trim() || undefined,
    });
  }

  return tracks;
}

function hasCaptionTracks(playerResponse: WatchPagePlayerResponse | null): boolean {
  return Boolean(playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length);
}

function inferCaptionContentType(rawText: string, url: string, extensionHint?: string): string {
  const trimmed = rawText.trimStart();
  let formatHint = (extensionHint ?? "").toLowerCase();

  try {
    const urlObject = new URL(url);
    formatHint ||= (urlObject.searchParams.get("fmt") ?? "").toLowerCase();
  } catch {
    // Ignore invalid URLs and fall back to the payload sniff.
  }

  if (formatHint === "json3" || trimmed.startsWith("{")) {
    return "application/json";
  }
  if (formatHint === "ttml" || trimmed.startsWith("<?xml") || trimmed.startsWith("<tt")) {
    return "application/ttml+xml";
  }
  if (trimmed.startsWith("<transcript") || trimmed.startsWith("<text")) {
    return "application/xml";
  }
  return "text/vtt";
}

function isValidCaptionPayload(text: string, contentType: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const normalizedType = contentType.toLowerCase();
  if (normalizedType.includes("html") && !trimmed.startsWith("{") && !trimmed.startsWith("<")) {
    return false;
  }

  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("WEBVTT") ||
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<tt") ||
    trimmed.startsWith("<transcript") ||
    trimmed.startsWith("<text")
  );
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchResponseWithRetries(url: string, init?: RequestInit): Promise<Response> {
  const retries = getCaptionFetchRetries();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getCaptionFetchTimeoutMs());

    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });

      if (response.ok || !shouldRetryStatus(response.status) || attempt === retries) {
        return response;
      }

      lastError = new Error(`Request failed with status ${response.status}.`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Network request failed.");
      if (attempt === retries) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeout);
    }

    await sleep(Math.min(1000, 250 * (attempt + 1)));
  }

  throw lastError ?? new Error("Network request failed.");
}

async function downloadCaptionPayload(
  url: string,
  extensionHint?: string,
  referer?: string,
): Promise<{ text: string; contentType: string }> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("Caption URL has an unsupported protocol.");
  }

  const response = await fetchResponseWithRetries(url, {
    headers: buildRequestHeaders({ referer }),
  });
  if (!response.ok) {
    throw new Error(`Failed to download YouTube captions (${response.status}).`);
  }

  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_CAPTION_PAYLOAD_BYTES) {
    throw new Error("Downloaded YouTube captions are too large to process safely.");
  }

  const contentType = response.headers.get("content-type") ?? inferCaptionContentType(text, url, extensionHint);
  if (!isValidCaptionPayload(text, contentType)) {
    throw new Error("Downloaded caption payload was empty or invalid.");
  }

  return { text, contentType };
}

function buildWatchPageUrl(youtubeId: string): string {
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", youtubeId);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "US");
  url.searchParams.set("persist_hl", "1");
  url.searchParams.set("persist_gl", "1");
  url.searchParams.set("has_verified", "1");
  url.searchParams.set("bpctr", "9999999999");
  return url.toString();
}

function buildMobileWatchPageUrl(youtubeId: string): string {
  const url = new URL("https://m.youtube.com/watch");
  url.searchParams.set("v", youtubeId);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "US");
  url.searchParams.set("persist_hl", "1");
  url.searchParams.set("persist_gl", "1");
  return url.toString();
}

function buildEmbedPageUrl(youtubeId: string): string {
  const url = new URL(`https://www.youtube.com/embed/${youtubeId}`);
  url.searchParams.set("hl", "en");
  url.searchParams.set("cc_lang_pref", "en");
  url.searchParams.set("cc_load_policy", "1");
  return url.toString();
}

function extractBalancedJsonObject(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index] ?? "";

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === "\\") {
        isEscaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractPlayerResponseFromWatchHtml(rawHtml: string): WatchPagePlayerResponse | null {
  const markers = [
    "ytInitialPlayerResponse = ",
    "var ytInitialPlayerResponse = ",
    "window['ytInitialPlayerResponse'] = ",
  ];

  for (const marker of markers) {
    const markerIndex = rawHtml.indexOf(marker);
    if (markerIndex < 0) {
      continue;
    }

    const objectStart = rawHtml.indexOf("{", markerIndex + marker.length);
    if (objectStart < 0) {
      continue;
    }

    const jsonText = extractBalancedJsonObject(rawHtml, objectStart);
    if (!jsonText) {
      continue;
    }

    try {
      return JSON.parse(jsonText) as WatchPagePlayerResponse;
    } catch {
      continue;
    }
  }

  return null;
}

function extractInnertubeValue(rawHtml: string, key: "INNERTUBE_API_KEY" | "VISITOR_DATA"): string | undefined {
  const camelKey = key === "INNERTUBE_API_KEY" ? "innertubeApiKey" : "visitorData";
  const patterns = [
    new RegExp(`"${key}":"([^"]+)"`),
    new RegExp(`"${camelKey}":"([^"]+)"`, "i"),
    new RegExp(`${key}\\s*[:=]\\s*"([^"]+)"`),
    new RegExp(`${camelKey}\\s*[:=]\\s*"([^"]+)"`, "i"),
  ];

  for (const pattern of patterns) {
    const match = rawHtml.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function extractInnertubeContext(rawHtml: string): InnertubeContext {
  return {
    apiKey: extractInnertubeValue(rawHtml, "INNERTUBE_API_KEY"),
    visitorData: extractInnertubeValue(rawHtml, "VISITOR_DATA"),
  };
}

function buildAndroidPlayerRequestBody(youtubeId: string, visitorData?: string): string {
  return JSON.stringify({
    context: {
      client: {
        clientName: "ANDROID",
        clientVersion: DEFAULT_ANDROID_INNERTUBE_CLIENT_VERSION,
        androidSdkVersion: 30,
        userAgent: DEFAULT_ANDROID_INNERTUBE_USER_AGENT,
        osName: "Android",
        osVersion: "11",
        hl: "en",
        gl: "US",
        visitorData,
      },
    },
    videoId: youtubeId,
    contentCheckOk: true,
    racyCheckOk: true,
  });
}

async function fetchInnertubePlayerResponse(
  youtubeId: string,
  sourceUrl: string,
  context: InnertubeContext,
): Promise<WatchPagePlayerResponse | null> {
  if (!context.apiKey) {
    return null;
  }

  const response = await fetchResponseWithRetries(`https://www.youtube.com/youtubei/v1/player?key=${context.apiKey}`, {
    method: "POST",
    headers: buildRequestHeaders({
      userAgent: DEFAULT_ANDROID_INNERTUBE_USER_AGENT,
      referer: sourceUrl,
      extra: {
        "content-type": "application/json",
        origin: "https://www.youtube.com",
        "x-goog-visitor-id": context.visitorData,
        "x-youtube-client-name": DEFAULT_ANDROID_INNERTUBE_CLIENT_NAME,
        "x-youtube-client-version": DEFAULT_ANDROID_INNERTUBE_CLIENT_VERSION,
      },
    }),
    body: buildAndroidPlayerRequestBody(youtubeId, context.visitorData),
  });

  if (!response.ok) {
    return null;
  }

  try {
    return (await response.json()) as WatchPagePlayerResponse;
  } catch {
    return null;
  }
}

async function fetchPlayerResponseFromHtmlSource(input: {
  youtubeId: string;
  sourceUrl: string;
  referer: string;
  userAgent?: string;
}): Promise<WatchPagePlayerResponse | null> {
  const response = await fetchResponseWithRetries(input.sourceUrl, {
    headers: buildRequestHeaders({
      referer: input.referer,
      userAgent: input.userAgent,
    }),
  });
  if (!response.ok) {
    return null;
  }

  const rawHtml = await response.text();
  const playerResponseFromHtml = extractPlayerResponseFromWatchHtml(rawHtml);
  if (hasCaptionTracks(playerResponseFromHtml)) {
    return playerResponseFromHtml;
  }

  const innertubeContext = extractInnertubeContext(rawHtml);
  try {
    const innertubePlayerResponse = await fetchInnertubePlayerResponse(
      input.youtubeId,
      input.sourceUrl,
      innertubeContext,
    );
    if (hasCaptionTracks(innertubePlayerResponse)) {
      return innertubePlayerResponse;
    }
  } catch {
    // Fall back to whichever player response was embedded in the HTML.
  }

  return playerResponseFromHtml;
}

async function fetchWatchPagePlayerResponse(youtubeId: string): Promise<WatchPagePlayerResponse | null> {
  const candidates = [
    {
      sourceUrl: buildWatchPageUrl(youtubeId),
      referer: "https://www.youtube.com/",
      userAgent: getWebUserAgent(),
    },
    {
      sourceUrl: buildMobileWatchPageUrl(youtubeId),
      referer: "https://m.youtube.com/",
      userAgent: DEFAULT_MOBILE_WEB_USER_AGENT,
    },
    {
      sourceUrl: buildEmbedPageUrl(youtubeId),
      referer: "https://www.youtube.com/",
      userAgent: getWebUserAgent(),
    },
  ];

  let fallbackResponse: WatchPagePlayerResponse | null = null;
  for (const candidate of candidates) {
    const response = await fetchPlayerResponseFromHtmlSource({
      youtubeId,
      sourceUrl: candidate.sourceUrl,
      referer: candidate.referer,
      userAgent: candidate.userAgent,
    });

    if (hasCaptionTracks(response)) {
      return response;
    }
    if (!fallbackResponse && response) {
      fallbackResponse = response;
    }
  }

  return fallbackResponse;
}

function inferTrackExtensionFromUrl(url: string): string | undefined {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.searchParams.get("fmt")?.toLowerCase() ?? undefined;
  } catch {
    return undefined;
  }
}

function buildCaptionTrackDownloadUrls(baseUrl: string): Array<{ url: string; extensionHint?: string }> {
  const candidates: Array<{ url: string; extensionHint?: string }> = [];

  try {
    const json3Url = new URL(baseUrl);
    json3Url.searchParams.set("fmt", "json3");
    candidates.push({ url: json3Url.toString(), extensionHint: "json3" });
  } catch {
    // Ignore invalid mutations and keep the raw URL fallback only.
  }

  if (!candidates.some((candidate) => candidate.url === baseUrl)) {
    candidates.push({ url: baseUrl, extensionHint: inferTrackExtensionFromUrl(baseUrl) });
  }

  return candidates;
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

export function parseCaptionPayload(rawText: string, contentType: string, extensionHint?: string): CaptionCue[] {
  const normalizedContentType = contentType.toLowerCase();
  const normalizedExtension = (extensionHint ?? "").toLowerCase();
  const trimmed = rawText.trimStart();

  if (normalizedExtension === "json3" || normalizedContentType.includes("json")) {
    return parseJson3Captions(rawText);
  }
  if (trimmed.startsWith("<transcript") || trimmed.startsWith("<text")) {
    return parseTimedTextXmlCaptions(rawText);
  }
  if (
    normalizedExtension === "ttml" ||
    normalizedContentType.includes("ttml") ||
    normalizedContentType.includes("xml")
  ) {
    return parseTtmlCaptions(rawText);
  }
  return parseWebVttCaptions(rawText);
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

export function createUnavailableCaptionProvider(): CaptionProvider {
  return {
    async fetchCaptions() {
      return {
        status: "unavailable",
        source: "youtube_captions",
        reason: "captions_provider_not_configured",
        message: "YouTube captions provider is not configured yet.",
      };
    },
  };
}

export function buildYtDlpVideoInfoArgs(youtubeUrl: string): string[] {
  return youtubeUrl ? [youtubeUrl] : [];
}

export function resolveYtDlpInvocations(): CommandInvocation[] {
  return [];
}

function createFetchCaptionProvider(): CaptionProvider {
  return {
    async fetchCaptions(input) {
      try {
        const watchUrl = buildWatchPageUrl(input.youtubeId);
        const playerResponse = await fetchWatchPagePlayerResponse(input.youtubeId);
        const rankedTracks = playerResponse
          ? rankWatchPageCaptionTracks(extractCaptionTracksFromPlayerResponse(playerResponse))
          : [];

        if (rankedTracks.length === 0) {
          return {
            status: "unavailable",
            source: "youtube_captions",
            reason: "captions_not_found",
            message: "No YouTube captions were available for this video.",
          };
        }

        let sawDownloadedPayload = false;
        let lastError: Error | null = null;

        for (const track of rankedTracks) {
          for (const candidate of buildCaptionTrackDownloadUrls(track.baseUrl)) {
            try {
              const downloaded = await downloadCaptionPayload(candidate.url, candidate.extensionHint, watchUrl);
              sawDownloadedPayload = true;
              const cues = parseCaptionPayload(downloaded.text, downloaded.contentType, candidate.extensionHint);
              if (cues.length > 0) {
                return {
                  status: "fetched",
                  source: "youtube_captions",
                  cues,
                  metadata: playerResponse ? toWatchPageMetadata(playerResponse) : undefined,
                };
              }
            } catch (error) {
              lastError = error instanceof Error ? error : new Error("Failed to download YouTube captions.");
            }
          }
        }

        if (sawDownloadedPayload) {
          return {
            status: "unavailable",
            source: "youtube_captions",
            reason: "captions_not_found",
            message: "Downloaded YouTube captions were empty.",
          };
        }

        throw lastError ?? new Error("Failed to download YouTube captions.");
      } catch (error) {
        return {
          status: "unavailable",
          source: "youtube_captions",
          reason: "captions_provider_failed",
          message: error instanceof Error ? error.message : "YouTube captions failed to fetch.",
        };
      }
    },
  };
}

export function createTimedTextCaptionProvider(): CaptionProvider {
  return createFetchCaptionProvider();
}

export function createYtDlpCaptionProvider(): CaptionProvider {
  return createFetchCaptionProvider();
}

export function getMaterialPipelineCaptionProvider(): CaptionProvider {
  return createFetchCaptionProvider();
}
