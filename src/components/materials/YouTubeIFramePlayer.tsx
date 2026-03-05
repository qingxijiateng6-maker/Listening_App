"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        config: {
          videoId: string;
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
    script.onerror = () => reject(new Error("Failed to load YouTube IFrame API."));
    document.body.appendChild(script);
  });

  return scriptLoadingPromise;
}

export function YouTubeIFramePlayer({ youtubeId, onTimeChange, onApiReady }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    const containerElement = containerRef.current;
    let player:
      | {
          getCurrentTime: () => number;
          seekTo: (seconds: number, allowSeekAhead: boolean) => void;
          playVideo: () => void;
          destroy: () => void;
        }
      | undefined;

    async function setupPlayer() {
      await loadYouTubeApiScript();
      if (cancelled || !containerElement || !window.YT?.Player) {
        return;
      }

      containerElement.innerHTML = "";
      player = new window.YT.Player(containerElement, {
        videoId: youtubeId,
        playerVars: {
          enablejsapi: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin,
        },
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
        if (!player) {
          return;
        }
          if (typeof player.getCurrentTime !== "function") {
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
      containerElement?.replaceChildren();
    };
  }, [onApiReady, onTimeChange, youtubeId]);

  return (
    <div className="youtubePlayerContainer">
      <div ref={containerRef} className="youtubePlayerFrame" />
    </div>
  );
}
