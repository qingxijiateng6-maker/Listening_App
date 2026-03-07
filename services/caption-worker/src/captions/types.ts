import type { SubtitleKind } from "../contracts.js";

export type CaptionCue = {
  startMs: number;
  endMs: number;
  text: string;
};

export type CaptionProviderInput = {
  materialId: string;
  jobId: string;
  attempt: number;
  youtubeId: string;
  youtubeUrl: string;
};

export type CaptionSelectionMetadata = {
  title?: string;
  channel?: string;
  durationSec?: number;
  videoLanguage?: string;
  subtitleLanguage: string;
  subtitleKind: SubtitleKind;
  subtitleName?: string;
};

export type MaterialSubtitlePatch = {
  title?: string;
  channel?: string;
  durationSec?: number;
  subtitle: {
    language: string;
    kind: SubtitleKind;
    name?: string;
    source: "yt_dlp";
    videoLanguage?: string;
  };
};

export type CaptionFetchResult =
  | {
      status: "fetched";
      source: "yt_dlp";
      cues: CaptionCue[];
      metadata: CaptionSelectionMetadata;
      materialPatch: MaterialSubtitlePatch;
    }
  | {
      status: "unavailable";
      source: "yt_dlp";
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

export type YtDlpSubtitleFormat = {
  ext?: string;
  url?: string;
  name?: string;
  protocol?: string;
};

export type YtDlpVideoInfo = {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  language?: string;
  original_language?: string;
  release_language?: string;
  webpage_url?: string;
  subtitles?: Record<string, YtDlpSubtitleFormat[] | undefined>;
  automatic_captions?: Record<string, YtDlpSubtitleFormat[] | undefined>;
};

export type CaptionTrackCandidate = {
  languageCode: string;
  normalizedLanguageCode: string;
  kind: SubtitleKind;
  name?: string;
  availableFormats: string[];
};

export type RankedCaptionTrack = CaptionTrackCandidate & {
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  preferredIndex: number;
  preferredSpecificity: number;
  videoLanguageSpecificity: number;
  formatPriority: number;
};
