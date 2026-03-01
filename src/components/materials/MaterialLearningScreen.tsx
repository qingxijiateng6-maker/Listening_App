"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Material, Segment } from "@/types/domain";
import { YouTubeIFramePlayer } from "@/components/materials/YouTubeIFramePlayer";

type Props = {
  materialId: string;
};

type SegmentWithId = Segment & { id: string };

type PlayerApi = {
  seekToMs: (ms: number) => void;
  play: () => void;
};

type MaterialApiResponse = {
  material: Material & { materialId: string };
  status: Material["status"];
};

type SegmentsApiResponse = {
  segments: Array<Segment & { segmentId: string }>;
};

function findActiveSegmentId(segments: SegmentWithId[], currentMs: number): string | null {
  let low = 0;
  let high = segments.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const segment = segments[mid];
    if (currentMs < segment.startMs) {
      high = mid - 1;
      continue;
    }
    if (currentMs > segment.endMs) {
      low = mid + 1;
      continue;
    }
    return segment.id;
  }
  return null;
}

export function MaterialLearningScreen({ materialId }: Props) {
  const [material, setMaterial] = useState<Material | null>(null);
  const [segments, setSegments] = useState<SegmentWithId[]>([]);
  const [playerApi, setPlayerApi] = useState<PlayerApi | null>(null);
  const [currentMs, setCurrentMs] = useState<number>(0);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingLabel, setLoadingLabel] = useState<string>("教材データを読み込んでいます...");
  const segmentButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function fetchJson<T>(url: string): Promise<T> {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        const fallbackMessage = url.endsWith(`/materials/${materialId}`)
          ? "教材が見つかりませんでした。"
          : "教材データの取得に失敗しました。";

        try {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error || fallbackMessage);
        } catch (parseError) {
          if (parseError instanceof Error) {
            throw parseError;
          }
          throw new Error(fallbackMessage);
        }
      }

      return (await response.json()) as T;
    }

    async function loadLearningData() {
      setLoading(true);
      setError("");
      setLoadingLabel("教材データを読み込んでいます...");
      try {
        setLoadingLabel("教材・字幕を取得しています...");
        const [materialPayload, segmentsPayload] = await Promise.all([
          fetchJson<MaterialApiResponse>(`/api/materials/${materialId}`),
          fetchJson<SegmentsApiResponse>(`/api/materials/${materialId}/segments`),
        ]);

        if (!mounted) {
          return;
        }

        const nextSegments = segmentsPayload.segments.map(({ segmentId, ...segment }) => ({
          id: segmentId,
          ...segment,
        }));

        setMaterial(materialPayload.material);
        setSegments(nextSegments);
        setSelectedSegmentId(nextSegments[0]?.id ?? "");
      } catch (loadError) {
        if (mounted && !(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError(loadError instanceof Error ? loadError.message : "教材取得に失敗しました。");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadLearningData();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [materialId]);

  const selectedSegment = useMemo(
    () => segments.find((segment) => segment.id === selectedSegmentId) ?? null,
    [segments, selectedSegmentId],
  );

  const activeSegmentId = useMemo(
    () => findActiveSegmentId(segments, currentMs),
    [currentMs, segments],
  );
  const activeSegment = useMemo(
    () => segments.find((segment) => segment.id === activeSegmentId) ?? null,
    [activeSegmentId, segments],
  );

  useEffect(() => {
    if (!activeSegmentId) {
      return;
    }
    segmentButtonRefs.current[activeSegmentId]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeSegmentId]);

  const handlePlayerReady = useCallback((api: PlayerApi) => {
    setPlayerApi(api);
  }, []);

  const handleTimeChange = useCallback((ms: number) => {
    setCurrentMs(ms);
  }, []);

  function seekToSegment(startMs: number): void {
    if (!playerApi) {
      return;
    }
    playerApi.seekToMs(startMs);
    playerApi.play();
  }

  return (
    <main className="learningScreen">
      <header className="learningScreenHeader">
        <div>
          <h1>学習画面</h1>
          <p className="learningScreenLead">動画と字幕だけを使って再生位置を確認できます。</p>
        </div>
        <div className="learningScreenMeta">
          <span className="learningMetaChip">materialId: {materialId}</span>
          {material ? <span className="learningMetaChip">status: {material.status}</span> : null}
          {material?.pipelineVersion ? (
            <span className="learningMetaChip">pipeline: {material.pipelineVersion}</span>
          ) : null}
        </div>
      </header>
      {loading ? (
        <section className="learningStateCard loading" aria-live="polite">
          <h2>読み込み中</h2>
          <p>{loadingLabel}</p>
        </section>
      ) : null}
      {error ? (
        <section className="learningStateCard error" role="alert">
          <h2>読み込みエラー</h2>
          <p>表示に必要なデータを読み込めませんでした。</p>
          <p>{error}</p>
        </section>
      ) : null}
      {material ? (
        <div className="learningLayout">
          <section className="playerTranscriptSection">
            <div className="playerTranscriptGrid">
              <div className="learningHeroSection playerColumn">
                <div className="learningSectionHeader">
                  <div>
                    <h2>動画</h2>
                    <p>字幕と行き来しながら再生できます。</p>
                  </div>
                </div>
                <YouTubeIFramePlayer
                  youtubeId={material.youtubeId}
                  onApiReady={handlePlayerReady}
                  onTimeChange={handleTimeChange}
                />
              </div>

              <div className="learningSection transcriptColumn">
                <div className="learningSectionHeader">
                  <div>
                    <h2>字幕</h2>
                    <p>再生位置: {(currentMs / 1000).toFixed(1)}s</p>
                  </div>
                  {activeSegment ? (
                    <div className="activeSubtitleSummary">
                      <span className="activeSubtitleLabel">再生中</span>
                      <p>{activeSegment.text}</p>
                    </div>
                  ) : (
                    <div className="activeSubtitleSummary idle">
                      <span className="activeSubtitleLabel">再生中</span>
                      <p>再生位置に対応する字幕がまだありません。</p>
                    </div>
                  )}
                </div>
                {segments.length === 0 ? (
                  <div className="learningEmptyCard">
                    <h3>字幕がまだありません</h3>
                    <p>字幕データの生成後にここへ表示されます。</p>
                  </div>
                ) : (
                  <div className="segmentList" aria-label="字幕一覧">
                    {segments.map((segment) => {
                      const isActive = segment.id === activeSegmentId;
                      const isSelected = segment.id === selectedSegmentId;
                      return (
                        <button
                          key={segment.id}
                          type="button"
                          className={`segmentButton${isActive ? " active" : ""}${isSelected ? " selected" : ""}`}
                          ref={(node) => {
                            segmentButtonRefs.current[segment.id] = node;
                          }}
                          onClick={() => {
                            setSelectedSegmentId(segment.id);
                            seekToSegment(segment.startMs);
                          }}
                        >
                          <span className="segmentTime">[{(segment.startMs / 1000).toFixed(1)}s]</span>
                          <span className="segmentText">{segment.text}</span>
                          <span className="segmentStateText">
                            {isActive ? "再生中" : isSelected ? "選択中" : "ジャンプ"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            {selectedSegment ? (
              <div className="subtitleTapPanel">
                <div className="learningSectionHeader compact">
                  <div>
                    <h3>選択中の字幕</h3>
                    <p>{selectedSegment.text}</p>
                  </div>
                  <button
                    type="button"
                    className="secondaryActionButton"
                    onClick={() => {
                      seekToSegment(selectedSegment.startMs);
                    }}
                  >
                    この位置から再生
                  </button>
                </div>
              </div>
            ) : (
              <div className="learningEmptyCard">
                <h3>字幕を選択してください</h3>
                <p>一覧から字幕をタップすると、その位置から動画を再生できます。</p>
              </div>
            )}
          </section>
        </div>
      ) : null}
      {!loading && !error && !material ? (
        <section className="learningStateCard empty">
          <h2>教材が見つかりません</h2>
          <p>登録状況を確認してから、もう一度開いてください。</p>
        </section>
      ) : null}
      <p className="learningBackLink">
        <Link href="/">トップへ戻る</Link>
      </p>
    </main>
  );
}
