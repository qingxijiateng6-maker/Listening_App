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
    }
  | {
      status: "unavailable";
      source: "youtube_captions";
      reason: "captions_not_found" | "captions_provider_not_configured";
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

function normalizeCaptionText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildSegmentId(index: number): string {
  return `seg-${String(index + 1).padStart(4, "0")}`;
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

export function getMaterialPipelineCaptionProvider(): CaptionProvider {
  return createUnavailableCaptionProvider();
}
