"use client";

import { useEffect, useId, useRef, useState } from "react";

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | HTMLIFrameElement,
        config: {
          videoId?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: () => void;
          };
        },
      ) => {
        getCurrentTime: () => number;
        seekTo: (seconds: number, allowSeekAhead: boolean) => void;
        playVideo: () => void;
        destroy: () => void;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type PlayerApi = {
  seekToMs: (ms: number) => void;
  play: () => void;
};

type Props = {
  youtubeId: string;
  onTimeChange: (currentMs: number) => void;
  onApiReady: (api: PlayerApi) => void;
};

let scriptLoadingPromise: Promise<void> | null = null;

function loadYouTubeApiScript(): Promise<void> {
  if (window.YT?.Player) {
    return Promise.resolve();
  }
  if (scriptLoadingPromise) {
    return scriptLoadingPromise;
  }

  scriptLoadingPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    window.onYouTubeIframeAPIReady = () => resolve();
    script.onerror = () => {
      scriptLoadingPromise = null;
      reject(new Error("Failed to load YouTube IFrame API."));
    };
    document.body.appendChild(script);
  });

  return scriptLoadingPromise;
}

export function buildYouTubeEmbedUrl(youtubeId: string, origin: string, widgetReferrer: string): string {
  const embedUrl = new URL(`https://www.youtube.com/embed/${youtubeId}`);
  embedUrl.searchParams.set("enablejsapi", "1");
  embedUrl.searchParams.set("playsinline", "1");
  embedUrl.searchParams.set("rel", "0");
  embedUrl.searchParams.set("origin", origin);
  embedUrl.searchParams.set("widget_referrer", widgetReferrer);
  return embedUrl.toString();
}

export function YouTubeIFramePlayer({ youtubeId, onTimeChange, onApiReady }: Props) {
  const iframeId = useId().replace(/:/g, "");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [embedUrl, setEmbedUrl] = useState("");

  useEffect(() => {
    setEmbedUrl(buildYouTubeEmbedUrl(youtubeId, window.location.origin, window.location.href));
  }, [youtubeId]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    const iframeElement = iframeRef.current;
    let player:
      | {
          getCurrentTime: () => number;
          seekTo: (seconds: number, allowSeekAhead: boolean) => void;
          playVideo: () => void;
          destroy: () => void;
        }
      | undefined;

    async function setupPlayer() {
      if (!embedUrl) {
        return;
      }

      await loadYouTubeApiScript();
      if (cancelled || !iframeElement || !window.YT?.Player) {
        return;
      }

      player = new window.YT.Player(iframeElement, {
        events: {
          onReady: () => {
            if (!player) {
              return;
            }
            onApiReady({
              seekToMs: (ms: number) => player?.seekTo(ms / 1000, true),
              play: () => player?.playVideo(),
            });
          },
        },
      });

      intervalId = window.setInterval(() => {
        if (!player || typeof player.getCurrentTime !== "function") {
          return;
        }
        onTimeChange(player.getCurrentTime() * 1000);
      }, 250);
    }

    void setupPlayer();
    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      if (player) {
        player.destroy();
      }
    };
  }, [embedUrl, onApiReady, onTimeChange]);

  return (
    <div className="youtubePlayerContainer">
      {embedUrl ? (
        <iframe
          id={`youtube-player-${iframeId}`}
          ref={iframeRef}
          className="youtubePlayerFrame"
          src={embedUrl}
          title="YouTube video player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="youtubePlayerFrame" aria-hidden="true" />
      )}
    </div>
  );
}
