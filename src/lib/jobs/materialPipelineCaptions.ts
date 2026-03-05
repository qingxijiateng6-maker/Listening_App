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

const DEFAULT_YT_DLP_COMMAND = "yt-dlp";
const PYTHON_YT_DLP_ARGS = ["-m", "yt_dlp"] as const;
const DEFAULT_YT_DLP_TIMEOUT_MS = 120_000;
const DEFAULT_CAPTION_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_CAPTION_FETCH_RETRIES = 2;
const MAX_CAPTION_PAYLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_YT_DLP_SUB_LANGS = "en.*,en";
const DEFAULT_YT_DLP_RETRIES = 3;
const DEFAULT_YT_DLP_EXTRACTOR_ARGS = "youtube:player_client=tv,android,web";
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

async function downloadCaptionPayload(url: string): Promise<{ text: string; contentType: string }> {
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
      const response = await fetch(url, { signal: controller.signal });
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

      return {
        text: payload,
        contentType: response.headers.get("content-type") ?? "",
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Caption download failed.");
      if (attempt > retries) {
        break;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Caption download failed.");
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

        const downloaded = await downloadCaptionPayload(selectedTrack.track.url);
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
  if (!getYtDlpCommand()) {
    return createUnavailableCaptionProvider();
  }
  return createYtDlpCaptionProvider();
}





