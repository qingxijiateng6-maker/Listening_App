import { execFile } from "node:child_process";

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

type YtDlpVideoInfo = {
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  subtitles?: Record<string, YtDlpSubtitleTrack[]>;
  automatic_captions?: Record<string, YtDlpSubtitleTrack[]>;
};

type YtDlpSubtitleTrack = {
  ext?: string;
  url?: string;
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

const DEFAULT_YT_DLP_COMMAND = "yt-dlp";
const PYTHON_YT_DLP_ARGS = ["-m", "yt_dlp"] as const;
const DEFAULT_CURL_COMMAND = "curl";
const DEFAULT_YT_DLP_TIMEOUT_MS = 120_000;
const DEFAULT_CAPTION_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_CAPTION_FETCH_RETRIES = 2;
const MAX_CAPTION_PAYLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_YT_DLP_SUB_LANGS = "en.*,en";
const DEFAULT_YT_DLP_RETRIES = 3;
const DEFAULT_YT_DLP_EXTRACTOR_ARGS = "youtube:player_client=tv,android,web";
const DEFAULT_ANDROID_INNERTUBE_CLIENT_NAME = "3";
const DEFAULT_ANDROID_INNERTUBE_CLIENT_VERSION = "21.02.35";
const DEFAULT_ANDROID_INNERTUBE_USER_AGENT =
  "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip";
const DEFAULT_YT_DLP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

type CommandInvocation = {
  command: string;
  args: string[];
};

function readEnvString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readEnvInt(name: string, fallback: number): number {
  const rawValue = readEnvString(name);
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function getYtDlpCommand(): string {
  return readEnvString("YT_DLP_PATH") ?? DEFAULT_YT_DLP_COMMAND;
}

function splitCommandString(commandText: string): string[] {
  return commandText
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function pushUniqueInvocation(invocations: CommandInvocation[], candidate: CommandInvocation): void {
  if (!candidate.command) {
    return;
  }

  const exists = invocations.some(
    (invocation) =>
      invocation.command === candidate.command &&
      invocation.args.length === candidate.args.length &&
      invocation.args.every((arg, index) => arg === candidate.args[index]),
  );
  if (!exists) {
    invocations.push(candidate);
  }
}

export function resolveYtDlpInvocations(): CommandInvocation[] {
  const configuredParts = splitCommandString(getYtDlpCommand());
  const invocations: CommandInvocation[] = [];

  if (configuredParts.length > 0) {
    pushUniqueInvocation(invocations, {
      command: configuredParts[0] ?? "",
      args: configuredParts.slice(1),
    });
  }

  pushUniqueInvocation(invocations, { command: DEFAULT_YT_DLP_COMMAND, args: [] });
  pushUniqueInvocation(invocations, { command: "python", args: [...PYTHON_YT_DLP_ARGS] });
  pushUniqueInvocation(invocations, { command: "py", args: [...PYTHON_YT_DLP_ARGS] });
  pushUniqueInvocation(invocations, { command: "python3", args: [...PYTHON_YT_DLP_ARGS] });

  return invocations;
}

function resolveCurlInvocations(): CommandInvocation[] {
  const invocations: CommandInvocation[] = [];
  pushUniqueInvocation(invocations, { command: DEFAULT_CURL_COMMAND, args: [] });
  pushUniqueInvocation(invocations, { command: "curl.exe", args: [] });
  return invocations;
}

function getYtDlpTimeoutMs(): number {
  return readEnvInt("YT_DLP_TIMEOUT_MS", DEFAULT_YT_DLP_TIMEOUT_MS);
}

function getCaptionFetchTimeoutMs(): number {
  return readEnvInt("YT_DLP_CAPTION_FETCH_TIMEOUT_MS", DEFAULT_CAPTION_FETCH_TIMEOUT_MS);
}

function getCaptionFetchRetries(): number {
  return readEnvInt("YT_DLP_CAPTION_FETCH_RETRIES", DEFAULT_CAPTION_FETCH_RETRIES);
}

function getYtDlpSubLangs(): string {
  return readEnvString("YT_DLP_SUB_LANGS") ?? DEFAULT_YT_DLP_SUB_LANGS;
}

function getYtDlpRetries(): number {
  return readEnvInt("YT_DLP_RETRIES", DEFAULT_YT_DLP_RETRIES);
}

function getYtDlpExtractorArgs(): string {
  return readEnvString("YT_DLP_EXTRACTOR_ARGS") ?? DEFAULT_YT_DLP_EXTRACTOR_ARGS;
}

function getYtDlpUserAgent(): string | undefined {
  return readEnvString("YT_DLP_USER_AGENT") ?? DEFAULT_YT_DLP_USER_AGENT;
}

function getYtDlpCookiesPath(): string | undefined {
  return readEnvString("YT_DLP_COOKIES_PATH");
}

function getYtDlpCookiesFromBrowser(): string | undefined {
  return readEnvString("YT_DLP_COOKIES_FROM_BROWSER");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
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

function buildYouTubeRequestHeaders(): HeadersInit {
  return {
    "accept-language": "en-US,en;q=0.9",
    "user-agent": getYtDlpUserAgent() ?? DEFAULT_YT_DLP_USER_AGENT,
  };
}

function buildSegmentId(index: number): string {
  return `seg-${String(index + 1).padStart(4, "0")}`;
}

function execFileAsync(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout: getYtDlpTimeoutMs(), maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const errorText = (stderr || error.message || "").trim();
          reject(new Error(errorText || "yt-dlp command failed."));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function parseTimestampToMs(raw: string): number | null {
  const value = raw.trim().replace(",", ".");
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

  const millis = (hours * 3600 + minutes * 60 + seconds) * 1000;
  return Number.isFinite(millis) ? Math.max(0, Math.round(millis)) : null;
}

function resolveLanguagePriority(languageCode: string): number {
  const patterns = getYtDlpSubLangs()
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
  if (prefixIndex >= 0) {
    return prefixIndex;
  }

  return Number.MAX_SAFE_INTEGER;
}

function resolveTrackExtPriority(ext: string | undefined): number {
  const normalized = (ext ?? "").toLowerCase();
  switch (normalized) {
    case "json3":
      return 0;
    case "srv3":
      return 1;
    case "vtt":
      return 2;
    case "ttml":
      return 3;
    default:
      return 100;
  }
}

function selectCaptionTrack(
  tracksByLanguage: Record<string, YtDlpSubtitleTrack[]> | undefined,
): { languageCode: string; track: YtDlpSubtitleTrack } | null {
  if (!tracksByLanguage) {
    return null;
  }

  const candidates = Object.entries(tracksByLanguage)
    .flatMap(([languageCode, tracks]) =>
      tracks
        .filter((track) => typeof track.url === "string" && track.url.length > 0)
        .map((track) => ({ languageCode, track })),
    )
    .sort((left, right) => {
      const priorityDiff = resolveLanguagePriority(left.languageCode) - resolveLanguagePriority(right.languageCode);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      const extDiff = resolveTrackExtPriority(left.track.ext) - resolveTrackExtPriority(right.track.ext);
      if (extDiff !== 0) {
        return extDiff;
      }
      return left.languageCode.localeCompare(right.languageCode);
    });

  return candidates[0] ?? null;
}

function toCaptionMetadata(videoInfo: YtDlpVideoInfo): CaptionMetadata {
  return {
    title: videoInfo.title?.trim() || undefined,
    channel: videoInfo.channel?.trim() || videoInfo.uploader?.trim() || undefined,
    durationSec:
      typeof videoInfo.duration === "number" && Number.isFinite(videoInfo.duration)
        ? Math.max(0, Math.round(videoInfo.duration))
        : undefined,
  };
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

function parseXmlAttributes(rawAttributes: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null = attributePattern.exec(rawAttributes);
  while (match) {
    const key = match[1] ?? "";
    const value = decodeHtmlEntities(match[2] ?? "");
    if (key) {
      attributes[key] = value;
    }
    match = attributePattern.exec(rawAttributes);
  }
  return attributes;
}

function normalizeTrackDisplayName(track: {
  name?: string;
  kind?: string;
  languageName: string;
}): string {
  const label = track.name?.trim();
  if (label) {
    return label;
  }

  return track.kind === "asr" ? `${track.languageName} (auto-generated)` : track.languageName;
}

function selectWatchPageCaptionTrack(tracks: WatchPageCaptionTrack[]): WatchPageCaptionTrack | null {
  if (tracks.length === 0) {
    return null;
  }

  const withPriority = tracks
    .map((track) => ({
      track,
      languagePriority: resolveLanguagePriority(track.languageCode),
      kindPriority: track.kind === "asr" ? 1 : 0,
      namePriority: normalizeTrackDisplayName(track).includes("Original") ? 0 : 1,
    }))
    .sort((left, right) => {
      if (left.languagePriority !== right.languagePriority) {
        return left.languagePriority - right.languagePriority;
      }
      if (left.kindPriority !== right.kindPriority) {
        return left.kindPriority - right.kindPriority;
      }
      if (left.namePriority !== right.namePriority) {
        return left.namePriority - right.namePriority;
      }
      return left.track.languageCode.localeCompare(right.track.languageCode);
    });

  return withPriority[0]?.track ?? null;
}

export function parseJson3Captions(rawJson: string): CaptionCue[] {
  const parsed = JSON.parse(stripBom(rawJson)) as Json3Captions;
  return (parsed.events ?? [])
    .map((event) => {
      const text = normalizeCaptionText(
        (event.segs ?? [])
          .map((segment) => segment.utf8 ?? "")
          .join("")
          .replace(/\r/g, " ")
          .replace(/\n/g, " "),
      );
      const startMs = Math.max(0, Math.round(event.tStartMs ?? 0));
      const durationMs = Math.max(0, Math.round(event.dDurationMs ?? 0));
      return {
        startMs,
        endMs: startMs + durationMs,
        text,
      };
    })
    .filter((cue) => cue.text.length > 0 && cue.endMs > cue.startMs);
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

    if (startMs === null || endMs === null || endMs <= startMs) {
      lineIndex += 1;
      continue;
    }

    const text = normalizeCaptionText(textLines.join(" "));
    if (!text) {
      lineIndex += 1;
      continue;
    }

    cues.push({ startMs, endMs, text });
    lineIndex += 1;
  }

  return cues;
}

export function parseTtmlCaptions(rawTtml: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const content = stripBom(rawTtml);
  const nodePattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null = nodePattern.exec(content);
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

export function parseCaptionPayload(rawText: string, contentType: string, extensionHint?: string): CaptionCue[] {
  const normalizedContentType = contentType.toLowerCase();
  const normalizedExt = (extensionHint ?? "").toLowerCase();

  if (normalizedExt === "json3" || normalizedContentType.includes("json")) {
    return parseJson3Captions(rawText);
  }
  if (normalizedExt === "ttml" || normalizedContentType.includes("ttml") || normalizedContentType.includes("xml")) {
    return parseTtmlCaptions(rawText);
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
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs || left.text.localeCompare(right.text));

  const deduped = normalized.filter((cue, index, items) => {
    const prev = items[index - 1];
    return !prev || prev.startMs !== cue.startMs || prev.endMs !== cue.endMs || prev.text !== cue.text;
  });

  return deduped.map((cue, index) => ({
    id: buildSegmentId(index),
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text,
  }));
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
  const args = [
    "--skip-download",
    "--dump-single-json",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    getYtDlpSubLangs(),
    "--sub-format",
    "json3/srv3/vtt/ttml",
    "--no-warnings",
    "--no-playlist",
    "--ignore-no-formats-error",
    "--retries",
    String(getYtDlpRetries()),
    "--extractor-retries",
    String(getYtDlpRetries()),
    "--extractor-args",
    getYtDlpExtractorArgs(),
    "--add-header",
    "Accept-Language:en-US,en;q=0.9",
  ];

  const userAgent = getYtDlpUserAgent();
  if (userAgent) {
    args.push("--user-agent", userAgent);
  }

  const cookiesPath = getYtDlpCookiesPath();
  const cookiesFromBrowser = getYtDlpCookiesFromBrowser();

  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  } else if (cookiesFromBrowser) {
    args.push("--cookies-from-browser", cookiesFromBrowser);
  }

  args.push(youtubeUrl);
  return args;
}

function inferCaptionContentType(rawText: string, url: string, extensionHint?: string): string {
  const trimmed = rawText.trimStart();
  const urlObject = new URL(url);
  const extension = (extensionHint ?? urlObject.searchParams.get("fmt") ?? "").toLowerCase();

  if (extension === "json3" || trimmed.startsWith("{")) {
    return "application/json";
  }
  if (extension === "ttml" || trimmed.startsWith("<?xml") || trimmed.startsWith("<tt")) {
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

async function downloadCaptionPayloadWithCurl(
  url: string,
  extensionHint?: string,
): Promise<{ text: string; contentType: string }> {
  const invocations = resolveCurlInvocations();
  let lastError: Error | null = null;

  for (const invocation of invocations) {
    try {
      const stdout = await execFileAsync(
        invocation.command,
        [
          ...invocation.args,
          "-L",
          "-sS",
          "--compressed",
          "-A",
          getYtDlpUserAgent() ?? DEFAULT_YT_DLP_USER_AGENT,
          "-H",
          "Accept-Language: en-US,en;q=0.9",
          url,
        ],
        process.cwd(),
      );

      if (Buffer.byteLength(stdout, "utf8") > MAX_CAPTION_PAYLOAD_BYTES) {
        throw new Error("Downloaded YouTube captions are too large to process safely.");
      }

      const contentType = inferCaptionContentType(stdout, url, extensionHint);
      if (!isValidCaptionPayload(stdout, contentType)) {
        throw new Error("Downloaded caption payload was empty or invalid.");
      }

      return { text: stdout, contentType };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("curl failed to download captions.");
    }
  }

  throw lastError ?? new Error("curl failed to download captions.");
}

async function downloadCaptionPayload(url: string, extensionHint?: string): Promise<{ text: string; contentType: string }> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("Caption URL has an unsupported protocol.");
  }

  const retries = getCaptionFetchRetries();
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= retries) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getCaptionFetchTimeoutMs());

    try {
      const response = await fetch(url, {
        headers: buildYouTubeRequestHeaders(),
        signal: controller.signal,
      });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt <= retries) {
          continue;
        }
        throw new Error(`Failed to download YouTube captions (${response.status}).`);
      }

      const payload = await response.text();
      if (Buffer.byteLength(payload, "utf8") > MAX_CAPTION_PAYLOAD_BYTES) {
        throw new Error("Downloaded YouTube captions are too large to process safely.");
      }

      const contentType = response.headers.get("content-type") ?? inferCaptionContentType(payload, url, extensionHint);
      if (!isValidCaptionPayload(payload, contentType)) {
        return await downloadCaptionPayloadWithCurl(url, extensionHint);
      }

      return {
        text: payload,
        contentType,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Caption download failed.");
      try {
        return await downloadCaptionPayloadWithCurl(url, extensionHint);
      } catch (curlError) {
        lastError = curlError instanceof Error ? curlError : new Error("Caption download failed.");
      }
      if (attempt > retries) {
        break;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Caption download failed.");
}

function buildWatchPageUrl(youtubeId: string): string {
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", youtubeId);
  return url.toString();
}

function parseTrackName(
  name: {
    simpleText?: string;
    runs?: Array<{
      text?: string;
    }>;
  } | undefined,
): string | undefined {
  const simpleText = name?.simpleText?.trim();
  if (simpleText) {
    return simpleText;
  }

  const text = name?.runs?.map((run) => run.text ?? "").join("").trim();
  return text || undefined;
}

function extractCaptionTracksFromPlayerResponse(playerResponse: WatchPagePlayerResponse): WatchPageCaptionTrack[] {
  return (playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).reduce<WatchPageCaptionTrack[]>(
    (tracks, track) => {
      const baseUrl = track.baseUrl?.trim() ?? "";
      const languageCode = track.languageCode?.trim() ?? "";
      if (!baseUrl || !languageCode) {
        return tracks;
      }

      tracks.push({
        baseUrl,
        languageCode,
        languageName: languageCode,
        kind: track.kind?.trim() || undefined,
        name: parseTrackName(track.name),
        vssId: track.vssId?.trim() || undefined,
      });
      return tracks;
    },
    [],
  );
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
  const markers = ["ytInitialPlayerResponse = ", "var ytInitialPlayerResponse = ", "window['ytInitialPlayerResponse'] = "];
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

function extractInnertubeApiKey(rawHtml: string): string | null {
  const match = rawHtml.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  return match?.[1] ?? null;
}

function buildAndroidPlayerRequestBody(youtubeId: string): string {
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
      },
    },
    videoId: youtubeId,
    contentCheckOk: true,
    racyCheckOk: true,
  });
}

async function fetchWatchPagePlayerResponse(youtubeId: string): Promise<WatchPagePlayerResponse | null> {
  const watchResponse = await fetch(buildWatchPageUrl(youtubeId), {
    headers: buildYouTubeRequestHeaders(),
  });
  if (!watchResponse.ok) {
    return null;
  }

  const rawHtml = await watchResponse.text();
  const apiKey = extractInnertubeApiKey(rawHtml);
  if (apiKey) {
    try {
      const playerResponse = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": DEFAULT_ANDROID_INNERTUBE_USER_AGENT,
          "x-youtube-client-name": DEFAULT_ANDROID_INNERTUBE_CLIENT_NAME,
          "x-youtube-client-version": DEFAULT_ANDROID_INNERTUBE_CLIENT_VERSION,
        },
        body: buildAndroidPlayerRequestBody(youtubeId),
      });
      if (playerResponse.ok) {
        const payload = (await playerResponse.json()) as WatchPagePlayerResponse;
        if (payload.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) {
          return payload;
        }
      }
    } catch {
      // Fall back to parsing the watch page HTML.
    }
  }

  return extractPlayerResponseFromWatchHtml(rawHtml);
}

function buildCaptionTrackDownloadUrls(baseUrl: string): Array<{ url: string; extensionHint?: string }> {
  const urls: Array<{ url: string; extensionHint?: string }> = [];

  try {
    const json3Url = new URL(baseUrl);
    json3Url.searchParams.set("fmt", "json3");
    urls.push({ url: json3Url.toString(), extensionHint: "json3" });
  } catch {
    // Ignore invalid URL mutation and keep the raw URL fallback.
  }

  urls.push({ url: baseUrl });
  return urls;
}

export function createTimedTextCaptionProvider(): CaptionProvider {
  return {
    async fetchCaptions(input) {
      try {
        const playerResponse = await fetchWatchPagePlayerResponse(input.youtubeId);
        const selectedTrack = playerResponse
          ? selectWatchPageCaptionTrack(extractCaptionTracksFromPlayerResponse(playerResponse))
          : null;
        if (!selectedTrack) {
          return {
            status: "unavailable",
            source: "youtube_captions",
            reason: "captions_not_found",
            message: "No YouTube captions were available for this video.",
          };
        }

        for (const candidate of buildCaptionTrackDownloadUrls(selectedTrack.baseUrl)) {
          const downloaded = await downloadCaptionPayload(candidate.url, candidate.extensionHint);
          const cues = parseCaptionPayload(downloaded.text, downloaded.contentType, candidate.extensionHint);
          if (cues.length > 0) {
            return {
              status: "fetched",
              source: "youtube_captions",
              cues,
              metadata: playerResponse ? toWatchPageMetadata(playerResponse) : undefined,
            };
          }
        }

        return {
          status: "unavailable",
          source: "youtube_captions",
          reason: "captions_not_found",
          message: "Downloaded YouTube captions were empty.",
        };
      } catch (error) {
        return {
          status: "unavailable",
          source: "youtube_captions",
          reason: "captions_provider_failed",
          message: error instanceof Error ? error.message : "YouTube timedtext failed to fetch captions.",
        };
      }
    },
  };
}

export function createYtDlpCaptionProvider(): CaptionProvider {
  return {
    async fetchCaptions(input) {
      try {
        const ytDlpArgs = buildYtDlpVideoInfoArgs(input.youtubeUrl);
        const invocations = resolveYtDlpInvocations();
        const primaryInvocation = invocations[0] ?? { command: DEFAULT_YT_DLP_COMMAND, args: [] };

        let stdout = "";
        try {
          stdout = await execFileAsync(primaryInvocation.command, [...primaryInvocation.args, ...ytDlpArgs], process.cwd());
        } catch (error) {
          let resolved = false;
          let lastError = error instanceof Error ? error : new Error("yt-dlp command failed.");

          for (const fallbackInvocation of invocations.slice(1)) {
            try {
              stdout = await execFileAsync(fallbackInvocation.command, [...fallbackInvocation.args, ...ytDlpArgs], process.cwd());
              resolved = true;
              break;
            } catch (fallbackError) {
              lastError = fallbackError instanceof Error ? fallbackError : new Error("yt-dlp command failed.");
            }
          }

          if (!resolved) {
            throw lastError;
          }
        }

        const videoInfo = JSON.parse(stdout) as YtDlpVideoInfo;
        const selectedTrack =
          selectCaptionTrack(videoInfo.subtitles) ?? selectCaptionTrack(videoInfo.automatic_captions);

        if (!selectedTrack?.track.url) {
          return {
            status: "unavailable",
            source: "youtube_captions",
            reason: "captions_not_found",
            message: "No YouTube captions were available for this video.",
          };
        }

        const downloaded = await downloadCaptionPayload(selectedTrack.track.url, selectedTrack.track.ext);
        const cues = parseCaptionPayload(downloaded.text, downloaded.contentType, selectedTrack.track.ext);
        if (cues.length === 0) {
          return {
            status: "unavailable",
            source: "youtube_captions",
            reason: "captions_not_found",
            message: "Downloaded YouTube captions were empty.",
          };
        }

        return {
          status: "fetched",
          source: "youtube_captions",
          cues,
          metadata: toCaptionMetadata(videoInfo),
        };
      } catch (error) {
        return {
          status: "unavailable",
          source: "youtube_captions",
          reason: "captions_provider_failed",
          message: error instanceof Error ? error.message : "yt-dlp failed to fetch captions.",
        };
      }
    },
  };
}

export function getMaterialPipelineCaptionProvider(): CaptionProvider {
  const ytDlpProvider = createYtDlpCaptionProvider();
  const timedTextProvider = createTimedTextCaptionProvider();

  return {
    async fetchCaptions(input) {
      const ytDlpResult = await ytDlpProvider.fetchCaptions(input);
      if (ytDlpResult.status === "fetched") {
        return ytDlpResult;
      }

      const timedTextResult = await timedTextProvider.fetchCaptions(input);
      if (timedTextResult.status === "fetched") {
        return timedTextResult;
      }

      return {
        status: "unavailable",
        source: "youtube_captions",
        reason: "captions_provider_failed",
        message: `${ytDlpResult.message} | ${timedTextResult.message}`,
      };
    },
  };
}





