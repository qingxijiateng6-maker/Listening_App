import { describe, expect, it } from "vitest";
import { buildSubtitleFormatPreference, rankSubtitleTracks, selectBestSubtitleTrack } from "./ranking.js";
import type { YtDlpVideoInfo } from "./types.js";

describe("rankSubtitleTracks", () => {
  it("uses preferred manual, then video language manual, then any manual before auto tracks", () => {
    const info: YtDlpVideoInfo = {
      language: "ja",
      subtitles: {
        en: [{ ext: "vtt", name: "English" }],
        fr: [{ ext: "vtt", name: "French" }],
        ja: [{ ext: "json3", name: "Japanese" }],
      },
      automatic_captions: {
        en: [{ ext: "vtt", name: "English auto" }],
        ja: [{ ext: "vtt", name: "Japanese auto" }],
      },
    };

    const ranked = rankSubtitleTracks({
      info,
      preferredLangs: ["en", "fr"],
    });

    expect(ranked.map((track) => `${track.tier}:${track.kind}:${track.languageCode}`)).toEqual([
      "1:manual:en",
      "1:manual:fr",
      "2:manual:ja",
      "4:auto:en",
      "5:auto:ja",
    ]);
  });

  it("falls back to any language when CAPTION_PREFERRED_LANGS is unset", () => {
    const info: YtDlpVideoInfo = {
      subtitles: {
        de: [{ ext: "vtt", name: "German" }],
      },
      automatic_captions: {
        en: [{ ext: "vtt", name: "English auto" }],
      },
    };

    const selected = selectBestSubtitleTrack({
      info,
      preferredLangs: [],
    });

    expect(selected).toMatchObject({
      tier: 3,
      kind: "manual",
      languageCode: "de",
    });
  });

  it("supports wildcard preferred languages and prefers better subtitle formats", () => {
    const info: YtDlpVideoInfo = {
      subtitles: {
        "en-US": [{ ext: "vtt", name: "English US" }],
        "en-GB": [{ ext: "json3", name: "English UK" }],
      },
    };

    const ranked = rankSubtitleTracks({
      info,
      preferredLangs: ["en.*"],
    });

    expect(ranked[0]).toMatchObject({
      languageCode: "en-GB",
      tier: 1,
    });
    expect(buildSubtitleFormatPreference(ranked[0]!)).toBe("json3");
  });
});
