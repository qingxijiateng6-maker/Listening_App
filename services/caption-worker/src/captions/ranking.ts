import type {
  CaptionTrackCandidate,
  RankedCaptionTrack,
  YtDlpSubtitleFormat,
  YtDlpVideoInfo,
} from "./types.js";

const SUBTITLE_FORMAT_PRIORITY = ["json3", "srv3", "srv2", "srv1", "vtt", "ttml", "srt"] as const;

function normalizeLanguageCode(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/_/g, "-").replace(/^\.+/, "");
}

function baseLanguageCode(value: string): string {
  return value.split("-")[0] ?? value;
}

function matchLanguage(candidate: string, target: string): number {
  if (!candidate || !target) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (candidate === target) {
    return 0;
  }
  return baseLanguageCode(candidate) === baseLanguageCode(target) ? 1 : Number.MAX_SAFE_INTEGER;
}

function matchPreferredLanguage(candidate: string, preferredLangs: string[]): { index: number; specificity: number } {
  for (let index = 0; index < preferredLangs.length; index += 1) {
    const preferred = normalizeLanguageCode(preferredLangs[index]);
    if (!preferred) {
      continue;
    }

    if (preferred.endsWith(".*")) {
      const prefix = preferred.slice(0, -2);
      if (candidate === prefix || candidate.startsWith(`${prefix}-`)) {
        return { index, specificity: candidate === prefix ? 0 : 1 };
      }
      continue;
    }

    const specificity = matchLanguage(candidate, preferred);
    if (specificity !== Number.MAX_SAFE_INTEGER) {
      return { index, specificity };
    }
  }

  return { index: Number.MAX_SAFE_INTEGER, specificity: Number.MAX_SAFE_INTEGER };
}

function rankFormat(formats: readonly string[]): number {
  let best = Number.MAX_SAFE_INTEGER;
  for (const format of formats) {
    const normalized = format.trim().toLowerCase();
    const index = SUBTITLE_FORMAT_PRIORITY.indexOf(
      normalized as (typeof SUBTITLE_FORMAT_PRIORITY)[number],
    );
    if (index >= 0 && index < best) {
      best = index;
    }
  }
  return best;
}

function isSupportedFormat(format: YtDlpSubtitleFormat): boolean {
  const ext = format.ext?.trim().toLowerCase();
  if (!ext) {
    return false;
  }
  return SUBTITLE_FORMAT_PRIORITY.includes(ext as (typeof SUBTITLE_FORMAT_PRIORITY)[number]);
}

function extractTrackCandidates(
  trackMap: Record<string, YtDlpSubtitleFormat[] | undefined> | undefined,
  kind: CaptionTrackCandidate["kind"],
): CaptionTrackCandidate[] {
  const candidates: CaptionTrackCandidate[] = [];

  for (const [languageCode, formats = []] of Object.entries(trackMap ?? {})) {
    const normalizedLanguageCode = normalizeLanguageCode(languageCode);
    if (!normalizedLanguageCode || normalizedLanguageCode === "live_chat") {
      continue;
    }

    const supportedFormats = formats
      .filter((format) => isSupportedFormat(format))
      .map((format) => format.ext!.trim().toLowerCase());
    if (supportedFormats.length === 0) {
      continue;
    }

    const name =
      formats
        .map((format) => format.name?.trim())
        .find((value) => Boolean(value)) ?? undefined;

    candidates.push({
      languageCode,
      normalizedLanguageCode,
      kind,
      name,
      availableFormats: Array.from(new Set(supportedFormats)),
    });
  }

  return candidates;
}

export function extractVideoLanguage(info: YtDlpVideoInfo): string | undefined {
  const candidates = [info.language, info.original_language, info.release_language];
  for (const candidate of candidates) {
    const normalized = normalizeLanguageCode(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

export function extractSubtitleTracks(info: YtDlpVideoInfo): CaptionTrackCandidate[] {
  return [
    ...extractTrackCandidates(info.subtitles, "manual"),
    ...extractTrackCandidates(info.automatic_captions, "auto"),
  ];
}

export function rankSubtitleTracks(input: {
  info: YtDlpVideoInfo;
  preferredLangs: string[];
}): RankedCaptionTrack[] {
  const preferredLangs = input.preferredLangs.map((value) => value.trim()).filter(Boolean);
  const videoLanguage = extractVideoLanguage(input.info);

  const ranked = extractSubtitleTracks(input.info).map((track) => {
    const preferred = matchPreferredLanguage(track.normalizedLanguageCode, preferredLangs);
    const videoLanguageSpecificity = videoLanguage
      ? matchLanguage(track.normalizedLanguageCode, videoLanguage)
      : Number.MAX_SAFE_INTEGER;

    let tier: RankedCaptionTrack["tier"];
    if (track.kind === "manual") {
      if (preferred.index !== Number.MAX_SAFE_INTEGER) {
        tier = 1;
      } else if (videoLanguageSpecificity !== Number.MAX_SAFE_INTEGER) {
        tier = 2;
      } else {
        tier = 3;
      }
    } else if (preferred.index !== Number.MAX_SAFE_INTEGER) {
      tier = 4;
    } else if (videoLanguageSpecificity !== Number.MAX_SAFE_INTEGER) {
      tier = 5;
    } else {
      tier = 6;
    }

    return {
      ...track,
      tier,
      preferredIndex: preferred.index,
      preferredSpecificity: preferred.specificity,
      videoLanguageSpecificity,
      formatPriority: rankFormat(track.availableFormats),
    };
  });

  ranked.sort((left, right) => {
    if (left.tier !== right.tier) {
      return left.tier - right.tier;
    }
    if (left.preferredIndex !== right.preferredIndex) {
      return left.preferredIndex - right.preferredIndex;
    }
    if (left.preferredSpecificity !== right.preferredSpecificity) {
      return left.preferredSpecificity - right.preferredSpecificity;
    }
    if (left.videoLanguageSpecificity !== right.videoLanguageSpecificity) {
      return left.videoLanguageSpecificity - right.videoLanguageSpecificity;
    }
    if (left.formatPriority !== right.formatPriority) {
      return left.formatPriority - right.formatPriority;
    }
    if (left.normalizedLanguageCode !== right.normalizedLanguageCode) {
      return left.normalizedLanguageCode < right.normalizedLanguageCode ? -1 : 1;
    }
    return (left.name ?? "").localeCompare(right.name ?? "");
  });

  return ranked;
}

export function selectBestSubtitleTrack(input: {
  info: YtDlpVideoInfo;
  preferredLangs: string[];
}): RankedCaptionTrack | null {
  return rankSubtitleTracks(input)[0] ?? null;
}

export function buildSubtitleFormatPreference(track: CaptionTrackCandidate): string {
  const sorted = [...track.availableFormats].sort((left, right) => {
    return rankFormat([left]) - rankFormat([right]);
  });
  return sorted.join("/");
}
