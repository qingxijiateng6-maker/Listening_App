"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Timestamp, doc, getDoc, getDocs, query, setDoc } from "firebase/firestore";
import { signInAnonymouslyIfNeeded, subscribeAuthState } from "@/lib/firebase/auth";
import { getDb, expressionsCollection, materialDoc, segmentsCollection, userExpressionsCollection } from "@/lib/firebase/firestore";
import type { Expression, Material, Segment, UserExpressionStatus } from "@/types/domain";
import { YouTubeIFramePlayer } from "@/components/materials/YouTubeIFramePlayer";

type Props = {
  materialId: string;
};

type SegmentWithId = Segment & { id: string };
type ExpressionWithId = Expression & { id: string };

type PlayerApi = {
  seekToMs: (ms: number) => void;
  play: () => void;
};

type UserExpressionStatusMap = Record<string, UserExpressionStatus>;
type GlossaryUiStatus = "idle" | "loading" | "ready" | "error";
const GLOSSARY_REQUEST_TIMEOUT_MS = 900;

type GlossaryApiResponse = {
  surfaceText: string;
  meaningJa: string;
  cacheHit: boolean;
  latencyMs: number;
};

function tokenizeSurfaceText(text: string): string[] {
  const matches = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  return Array.from(new Set(matches.map((word) => word.toLowerCase())));
}

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
  const [expressions, setExpressions] = useState<ExpressionWithId[]>([]);
  const [uid, setUid] = useState<string>("");
  const [playerApi, setPlayerApi] = useState<PlayerApi | null>(null);
  const [currentMs, setCurrentMs] = useState<number>(0);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>("");
  const [selectedWord, setSelectedWord] = useState<string>("");
  const [glossaryMeaning, setGlossaryMeaning] = useState<string>("");
  const [glossaryStatus, setGlossaryStatus] = useState<GlossaryUiStatus>("idle");
  const [glossaryMeta, setGlossaryMeta] = useState<string>("");
  const [userExpressionStatuses, setUserExpressionStatuses] = useState<UserExpressionStatusMap>({});
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [sessionGlossaryCache, setSessionGlossaryCache] = useState<Record<string, string>>({});
  const segmentButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    let mounted = true;

    async function loadLearningData() {
      try {
        await signInAnonymouslyIfNeeded();

        const [materialSnapshot, segmentsSnapshot, expressionsSnapshot] = await Promise.all([
          getDoc(materialDoc(materialId)),
          getDocs(query(segmentsCollection(materialId))),
          getDocs(query(expressionsCollection(materialId))),
        ]);

        if (!mounted) {
          return;
        }

        if (!materialSnapshot.exists()) {
          setError("教材が見つかりませんでした。");
          return;
        }

        const nextSegments = segmentsSnapshot.docs
          .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
          .sort((a, b) => a.startMs - b.startMs);
        const nextExpressions = expressionsSnapshot.docs
          .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
          .sort((a, b) => b.scoreFinal - a.scoreFinal);

        setMaterial(materialSnapshot.data());
        setSegments(nextSegments);
        setExpressions(nextExpressions);
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "教材取得に失敗しました。");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    const unsubscribe = subscribeAuthState((user) => {
      if (!mounted) {
        return;
      }
      setUid(user?.uid ?? "");
    });

    void loadLearningData();
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [materialId]);

  useEffect(() => {
    let active = true;
    if (!uid) {
      setUserExpressionStatuses({});
      return;
    }

    async function loadUserStatuses() {
      const snapshot = await getDocs(userExpressionsCollection(uid));
      if (!active) {
        return;
      }
      const map: UserExpressionStatusMap = {};
      snapshot.docs.forEach((entry) => {
        map[entry.id] = entry.data().status;
      });
      setUserExpressionStatuses(map);
    }

    void loadUserStatuses();
    return () => {
      active = false;
    };
  }, [uid]);

  const selectedSegment = useMemo(
    () => segments.find((segment) => segment.id === selectedSegmentId) ?? null,
    [segments, selectedSegmentId],
  );
  const selectableWords = useMemo(
    () => tokenizeSurfaceText(selectedSegment?.text ?? ""),
    [selectedSegment?.text],
  );

  const activeSegmentId = useMemo(
    () => findActiveSegmentId(segments, currentMs),
    [currentMs, segments],
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

  async function updateExpressionStatus(
    expressionId: string,
    status: UserExpressionStatus,
  ): Promise<void> {
    if (!uid) {
      return;
    }
    await setDoc(
      doc(getDb(), "users", uid, "expressions", expressionId),
      {
        status,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
    setUserExpressionStatuses((prev) => ({ ...prev, [expressionId]: status }));
  }

  function seekToSegment(startMs: number): void {
    if (!playerApi) {
      return;
    }
    playerApi.seekToMs(startMs);
    playerApi.play();
  }

  async function fetchGlossary(surfaceText: string): Promise<void> {
    const normalizedWord = surfaceText.toLowerCase();
    setSelectedWord(normalizedWord);

    const inMemoryMeaning = sessionGlossaryCache[normalizedWord];
    if (inMemoryMeaning) {
      setGlossaryStatus("ready");
      setGlossaryMeaning(inMemoryMeaning);
      setGlossaryMeta("source: session-cache");
      return;
    }

    setGlossaryStatus("loading");
    setGlossaryMeaning("");
    setGlossaryMeta("");

    const placeholderTimer = window.setTimeout(() => {
      setGlossaryMeaning("意味を取得中です...");
      setGlossaryMeta("source: loading-placeholder");
    }, 450);

    const startedAt = performance.now();
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), GLOSSARY_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`/api/materials/${materialId}/glossary`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ surfaceText: normalizedWord }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Glossary fetch failed: ${response.status}`);
      }

      const payload = (await response.json()) as GlossaryApiResponse;
      const totalMs = Math.round(performance.now() - startedAt);

      setGlossaryStatus("ready");
      setGlossaryMeaning(payload.meaningJa);
      setGlossaryMeta(
        `source: ${payload.cacheHit ? "firestore-cache" : "generated"} / api: ${payload.latencyMs}ms / total: ${totalMs}ms`,
      );
      setSessionGlossaryCache((prev) => ({ ...prev, [normalizedWord]: payload.meaningJa }));
    } catch (glossaryError) {
      setGlossaryStatus("error");
      if (glossaryError instanceof DOMException && glossaryError.name === "AbortError") {
        setGlossaryMeaning("応答が遅いためタイムアウトしました。もう一度タップしてください。");
        setGlossaryMeta(`timeout: ${GLOSSARY_REQUEST_TIMEOUT_MS}ms`);
      } else {
        setGlossaryMeaning("意味取得に失敗しました。");
        setGlossaryMeta(glossaryError instanceof Error ? glossaryError.message : "unknown error");
      }
    } finally {
      window.clearTimeout(placeholderTimer);
      window.clearTimeout(requestTimeout);
    }
  }

  return (
    <main>
      <h1>学習画面</h1>
      {loading ? <p>読み込み中...</p> : null}
      {error ? <p>{error}</p> : null}
      {material ? (
        <>
          <section>
            <p>materialId: {materialId}</p>
            <p>status: {material.status}</p>
            <p>pipelineVersion: {material.pipelineVersion}</p>
            <YouTubeIFramePlayer
              youtubeId={material.youtubeId}
              onApiReady={handlePlayerReady}
              onTimeChange={handleTimeChange}
            />
          </section>

          <section>
            <h2>字幕</h2>
            <p>再生位置: {(currentMs / 1000).toFixed(1)}s</p>
            <div>
              {segments.map((segment) => {
                const isActive = segment.id === activeSegmentId;
                return (
                  <button
                    key={segment.id}
                    type="button"
                    className={`segmentButton${isActive ? " active" : ""}`}
                    ref={(node) => {
                      segmentButtonRefs.current[segment.id] = node;
                    }}
                    onClick={() => {
                      setSelectedSegmentId(segment.id);
                      setSelectedWord("");
                      setGlossaryMeaning("");
                      setGlossaryMeta("");
                      setGlossaryStatus("idle");
                      seekToSegment(segment.startMs);
                    }}
                  >
                    [{(segment.startMs / 1000).toFixed(1)}] {segment.text}
                  </button>
                );
              })}
            </div>
            {selectedSegment ? (
              <div className="subtitleTapPanel">
                <p>タップした字幕</p>
                <p>{selectedSegment.text}</p>
                <div className="wordButtons">
                  {selectableWords.map((word) => (
                    <button key={word} type="button" onClick={() => void fetchGlossary(word)}>
                      {word}
                    </button>
                  ))}
                </div>
                {selectedWord ? (
                  <div className="glossaryPanel">
                    <p>語句: {selectedWord}</p>
                    <p>{glossaryMeaning}</p>
                    <p>status: {glossaryStatus}</p>
                    {glossaryMeta ? <p>{glossaryMeta}</p> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section>
            <h2>重要表現</h2>
            {expressions.map((expression) => {
              const status = userExpressionStatuses[expression.id] ?? "";
              const firstOccurrence = expression.occurrences[0];
              return (
                <article key={expression.id} className="expressionCard">
                  <h3>{expression.expressionText}</h3>
                  <p>意味: {expression.meaningJa}</p>
                  <p>例文: {expression.scenarioExample}</p>
                  <p>status: {status || "unset"}</p>
                  <p>
                    <button
                      type="button"
                      onClick={() => {
                        if (firstOccurrence) {
                          seekToSegment(firstOccurrence.startMs);
                        }
                      }}
                      disabled={!firstOccurrence}
                    >
                      該当シーン再生
                    </button>
                  </p>
                  <p className="statusActions">
                    <button type="button" onClick={() => void updateExpressionStatus(expression.id, "saved")}>
                      保存
                    </button>
                    <button type="button" onClick={() => void updateExpressionStatus(expression.id, "ignored")}>
                      除外
                    </button>
                    <button type="button" onClick={() => void updateExpressionStatus(expression.id, "mastered")}>
                      習得
                    </button>
                  </p>
                </article>
              );
            })}
          </section>
        </>
      ) : null}
      <p>
        <Link href="/">トップへ戻る</Link>
      </p>
    </main>
  );
}
