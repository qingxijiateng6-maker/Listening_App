import { describe, expect, it } from "vitest";
import { parseYouTubeUrl } from "@/lib/youtube";

describe("parseYouTubeUrl", () => {
  it("accepts standard watch url", () => {
    const parsed = parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(parsed).toEqual({
      youtubeId: "dQw4w9WgXcQ",
      normalizedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it("accepts short url", () => {
    const parsed = parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ");
    expect(parsed?.youtubeId).toBe("dQw4w9WgXcQ");
  });

  it("rejects non-youtube url", () => {
    const parsed = parseYouTubeUrl("https://example.com/watch?v=dQw4w9WgXcQ");
    expect(parsed).toBeNull();
  });
});
