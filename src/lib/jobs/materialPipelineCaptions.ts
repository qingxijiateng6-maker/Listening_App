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

const YT_DLP_COMMAND = process.env.YT_DLP_PATH?.trim() || "yt-dlp";
const YT_DLP_TIMEOUT_MS = Number.parseInt(process.env.YT_DLP_TIMEOUT_MS ?? "120000", 10);
const YT_DLP_SUB_LANGS = process.env.YT_DLP_SUB_LANGS?.trim() || "en.*,en";

function normalizeCaptionText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildSegmentId(index: number): string {
  return `seg-${String(index + 1).padStart(4, "0")}`;
}

function execFileAsync(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: YT_DLP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function resolveLanguagePriority(languageCode: string): number {
  const patterns = YT_DLP_SUB_LANGS.split(",")
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

function selectCaptionTrack(
  tracksByLanguage: Record<string, YtDlpSubtitleTrack[]> | undefined,
): { languageCode: string; track: YtDlpSubtitleTrack } | null {
  if (!tracksByLanguage) {
    return null;
  }

  const candidates = Object.entries(tracksByLanguage)
    .flatMap(([languageCode, tracks]) =>
      tracks
        .filter((track) => track.ext === "json3" && typeof track.url === "string" && track.url.length > 0)
        .map((track) => ({ languageCode, track })),
    )
    .sort((left, right) => {
      const priorityDiff = resolveLanguagePriority(left.languageCode) - resolveLanguagePriority(right.languageCode);
      if (priorityDiff !== 0) {
        return priorityDiff;
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
  const parsed = JSON.parse(rawJson) as Json3Captions;
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

export function createYtDlpCaptionProvider(): CaptionProvider {
  return {
    async fetchCaptions(input) {
      try {
        const stdout = await execFileAsync(
          YT_DLP_COMMAND,
          [
            "--skip-download",
            "--dump-single-json",
            "--no-warnings",
            input.youtubeUrl,
          ],
          process.cwd(),
        );

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

        const captionResponse = await fetch(selectedTrack.track.url);
        if (!captionResponse.ok) {
          return {
            status: "unavailable",
            source: "youtube_captions",
            reason: "captions_provider_failed",
            message: `Failed to download YouTube captions (${captionResponse.status}).`,
          };
        }

        const captionJson = await captionResponse.text();
        const cues = parseJson3Captions(captionJson);
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
  if (!YT_DLP_COMMAND) {
    return createUnavailableCaptionProvider();
  }
  return createYtDlpCaptionProvider();
}
