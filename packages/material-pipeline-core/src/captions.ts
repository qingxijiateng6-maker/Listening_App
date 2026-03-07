export type SubtitleMetadata = {
  title?: string;
  channel?: string;
  durationSec?: number;
};

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

export type CaptionFetchResult =
  | {
      status: "fetched";
      source: "youtube_captions";
      cues: CaptionCue[];
      metadata?: SubtitleMetadata;
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
