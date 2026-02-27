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

  scriptLoadingPromise = new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    window.onYouTubeIframeAPIReady = () => resolve();
    document.body.appendChild(script);
  });

  return scriptLoadingPromise;
}

export function YouTubeIFramePlayer({ youtubeId, onTimeChange, onApiReady }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    let player:
      | {
          getCurrentTime: () => number;
          seekTo: (seconds: number, allowSeekAhead: boolean) => void;
          playVideo: () => void;
        }
      | undefined;

    async function setupPlayer() {
      await loadYouTubeApiScript();
      if (cancelled || !containerRef.current || !window.YT?.Player) {
        return;
      }

      player = new window.YT.Player(containerRef.current, {
        videoId: youtubeId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
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
        onTimeChange(player.getCurrentTime() * 1000);
      }, 250);
    }

    void setupPlayer();
    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [onApiReady, onTimeChange, youtubeId]);

  return (
    <div className="youtubePlayerContainer">
      <div ref={containerRef} className="youtubePlayerFrame" />
    </div>
  );
}
