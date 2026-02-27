const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

type ParsedYouTubeUrl = {
  normalizedUrl: string;
  youtubeId: string;
};

function extractIdFromUrl(url: URL): string | null {
  if (url.hostname.includes("youtu.be")) {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  if (url.pathname.startsWith("/shorts/")) {
    const id = url.pathname.split("/").filter(Boolean)[1] ?? "";
    return VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  return null;
}

export function parseYouTubeUrl(rawInput: string): ParsedYouTubeUrl | null {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname)) {
    return null;
  }

  const youtubeId = extractIdFromUrl(url);
  if (!youtubeId) {
    return null;
  }

  return {
    youtubeId,
    normalizedUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
  };
}

export async function isPubliclyAccessibleYouTubeVideo(youtubeId: string): Promise<boolean> {
  const targetUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`;
  const response = await fetch(oembedUrl);
  return response.ok;
}
