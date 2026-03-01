"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signInAnonymouslyIfNeeded, subscribeAuthState } from "@/lib/firebase/auth";
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
const STATUS_DOUBLE_CLICK_WINDOW_MS = 400;

type GlossaryApiResponse = {
  surfaceText: string;
  meaningJa: string;
  cacheHit: boolean;
  latencyMs: number;
};

type MaterialApiResponse = {
  material: Material & { materialId: string };
  status: Material["status"];
};

type SegmentsApiResponse = {
  segments: Array<Segment & { segmentId: string }>;
};

type ExpressionsApiResponse = {
  expressions: Array<Expression & { expressionId: string }>;
};

type UserExpressionRecord = {
  expressionId: string;
  status: UserExpressionStatus;
  updatedAt: string;
};

type UserExpressionsApiResponse = {
  expressions: UserExpressionRecord[];
};

const EXPRESSION_STATUS_LABELS: Record<UserExpressionStatus, string> = {
  saved: "保存済み",
  ignored: "除外",
  mastered: "習得済み",
};

function tokenizeSurfaceText(text: string): string[] {
  const matches = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  return Array.from(new Set(matches.map((word) => word.toLowerCase())));
}

function normalizeGlossaryCacheKey(surfaceText: string): string {
  return surfaceText
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[\s"'`“”‘’「」『』（）()［］\[\]{}<>.,!?;:]+|[\s"'`“”‘’「」『』（）()［］\[\]{}<>.,!?;:]+$/g, "")
    .replace(/\s*([/-])\s*/g, "$1")
    .replace(/\s*'\s*/g, "'")
    .toLowerCase();
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
  const [expressionStatusLoadingId, setExpressionStatusLoadingId] = useState<string>("");
  const [expressionStatusErrorById, setExpressionStatusErrorById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingLabel, setLoadingLabel] = useState<string>("教材データを読み込んでいます...");
  const [sessionGlossaryCache, setSessionGlossaryCache] = useState<Record<string, string>>({});
  const segmentButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const expressionActionClickRef = useRef<Record<string, { status: UserExpressionStatus; at: number }>>({});

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
        await signInAnonymouslyIfNeeded();

        setLoadingLabel("教材・字幕・重要表現を取得しています...");
        const [materialPayload, segmentsPayload, expressionsPayload] = await Promise.all([
          fetchJson<MaterialApiResponse>(`/api/materials/${materialId}`),
          fetchJson<SegmentsApiResponse>(`/api/materials/${materialId}/segments`),
          fetchJson<ExpressionsApiResponse>(`/api/materials/${materialId}/expressions`),
        ]);

        if (!mounted) {
          return;
        }

        const nextSegments = segmentsPayload.segments.map(({ segmentId, ...segment }) => ({
          id: segmentId,
          ...segment,
        }));
        const nextExpressions = expressionsPayload.expressions.map(({ expressionId, ...expression }) => ({
          id: expressionId,
          ...expression,
        }));

        setMaterial(materialPayload.material);
        setSegments(nextSegments);
        setExpressions(nextExpressions);
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

    const unsubscribe = subscribeAuthState((user) => {
      if (!mounted) {
        return;
      }
      setUid(user?.uid ?? "");
    });

    void loadLearningData();
    return () => {
      mounted = false;
      controller.abort();
      unsubscribe();
    };
  }, [materialId]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!uid) {
      setUserExpressionStatuses({});
      setExpressionStatusErrorById({});
      return;
    }

    async function loadUserStatuses() {
      try {
        const response = await fetch("/api/users/me/expressions", {
          method: "GET",
          headers: {
            "x-user-id": uid,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = "学習状態の取得に失敗しました。";
          try {
            const payload = (await response.json()) as { error?: string };
            message = payload.error || message;
          } catch {
            // Fall back to the default message when the error body is not JSON.
          }
          throw new Error(message);
        }

        const payload = (await response.json()) as UserExpressionsApiResponse;
        if (!active) {
          return;
        }

        const map: UserExpressionStatusMap = {};
        payload.expressions.forEach((expression) => {
          map[expression.expressionId] = expression.status;
        });
        setUserExpressionStatuses(map);
        setExpressionStatusErrorById({});
      } catch (loadError) {
        if (!active || (loadError instanceof DOMException && loadError.name === "AbortError")) {
          return;
        }

        setUserExpressionStatuses({});
        setExpressionStatusErrorById((prev) => ({
          ...prev,
          __load__: loadError instanceof Error ? loadError.message : "学習状態の取得に失敗しました。",
        }));
      }
    }

    void loadUserStatuses();
    return () => {
      active = false;
      controller.abort();
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

  async function updateExpressionStatus(
    expressionId: string,
    status: UserExpressionStatus,
  ): Promise<void> {
    if (!uid) {
      return;
    }

    setExpressionStatusLoadingId(expressionId);
    setExpressionStatusErrorById((prev) => ({ ...prev, [expressionId]: "" }));

    try {
      const response = await fetch(`/api/users/me/expressions/${expressionId}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-user-id": uid,
        },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        let message = "学習状態の更新に失敗しました。再試行してください。";
        try {
          const payload = (await response.json()) as { error?: string };
          message = payload.error || message;
        } catch {
          // Fall back to the default message when the error body is not JSON.
        }
        throw new Error(message);
      }

      const payload = (await response.json()) as UserExpressionRecord;
      setUserExpressionStatuses((prev) => ({ ...prev, [expressionId]: payload.status }));
    } catch (updateError) {
      setExpressionStatusErrorById((prev) => ({
        ...prev,
        [expressionId]:
          updateError instanceof Error
            ? updateError.message
            : "学習状態の更新に失敗しました。再試行してください。",
      }));
    } finally {
      setExpressionStatusLoadingId((current) => (current === expressionId ? "" : current));
    }
  }

  async function clearExpressionStatus(expressionId: string): Promise<void> {
    if (!uid) {
      return;
    }

    setExpressionStatusLoadingId(expressionId);
    setExpressionStatusErrorById((prev) => ({ ...prev, [expressionId]: "" }));

    try {
      const response = await fetch(`/api/users/me/expressions/${expressionId}`, {
        method: "DELETE",
        headers: {
          "x-user-id": uid,
        },
      });

      if (!response.ok) {
        let message = "学習状態の解除に失敗しました。再試行してください。";
        try {
          const payload = (await response.json()) as { error?: string };
          message = payload.error || message;
        } catch {
          // Fall back to the default message when the error body is not JSON.
        }
        throw new Error(message);
      }

      setUserExpressionStatuses((prev) => {
        const next = { ...prev };
        delete next[expressionId];
        return next;
      });
    } catch (updateError) {
      setExpressionStatusErrorById((prev) => ({
        ...prev,
        [expressionId]:
          updateError instanceof Error
            ? updateError.message
            : "学習状態の解除に失敗しました。再試行してください。",
      }));
    } finally {
      setExpressionStatusLoadingId((current) => (current === expressionId ? "" : current));
    }
  }

  function seekToSegment(startMs: number): void {
    if (!playerApi) {
      return;
    }
    playerApi.seekToMs(startMs);
    playerApi.play();
  }

  async function fetchGlossary(surfaceText: string): Promise<void> {
    const normalizedWord = normalizeGlossaryCacheKey(surfaceText);
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
      const cacheKey = normalizeGlossaryCacheKey(payload.surfaceText);

      setGlossaryStatus("ready");
      setSelectedWord(payload.surfaceText);
      setGlossaryMeaning(payload.meaningJa);
      setGlossaryMeta(
        `source: ${payload.cacheHit ? "firestore-cache" : "generated"} / api: ${payload.latencyMs}ms / total: ${totalMs}ms`,
      );
      setSessionGlossaryCache((prev) => ({ ...prev, [cacheKey]: payload.meaningJa }));
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

  function resetGlossaryState(): void {
    setSelectedWord("");
    setGlossaryMeaning("");
    setGlossaryMeta("");
    setGlossaryStatus("idle");
  }

  function getExpressionStatusLabel(status: UserExpressionStatusMap[string]): string {
    if (!status) {
      return "未設定";
    }

    return EXPRESSION_STATUS_LABELS[status] ?? status;
  }

  function handleExpressionStatusAction(expressionId: string, nextStatus: UserExpressionStatus, currentStatus: string): void {
    const now = Date.now();
    const lastClick = expressionActionClickRef.current[expressionId];

    if (
      currentStatus === nextStatus &&
      lastClick?.status === nextStatus &&
      now - lastClick.at <= STATUS_DOUBLE_CLICK_WINDOW_MS
    ) {
      delete expressionActionClickRef.current[expressionId];
      void clearExpressionStatus(expressionId);
      return;
    }

    expressionActionClickRef.current[expressionId] = {
      status: nextStatus,
      at: now,
    };

    if (currentStatus !== nextStatus) {
      void updateExpressionStatus(expressionId, nextStatus);
    }
  }

  return (
    <main className="learningScreen">
      <header className="learningScreenHeader">
        <div>
          <h1>学習画面</h1>
          <p className="learningScreenLead">字幕から語句を確認し、重要表現をそのまま学習できます。</p>
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
                    <h2>教材</h2>
                    <p>再生と字幕を行き来しながら学習できます。</p>
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
                            resetGlossaryState();
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
                      resetGlossaryState();
                      seekToSegment(selectedSegment.startMs);
                    }}
                  >
                    この位置から再生
                  </button>
                </div>
                {selectableWords.length > 0 ? (
                  <div className="wordButtons">
                    {selectableWords.map((word) => (
                      <button
                        key={word}
                        type="button"
                        className={selectedWord === word ? "selected" : ""}
                        onClick={() => void fetchGlossary(word)}
                      >
                        {word}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="learningEmptyCard compact">
                    <p>辞書候補になる語句がまだ見つかりません。</p>
                  </div>
                )}
                <div className={`glossaryPanel ${glossaryStatus}`}>
                  <div className="glossaryHeader">
                    <div>
                      <h3>Glossary</h3>
                      <p>{selectedWord ? `語句: ${selectedWord}` : "語句をタップすると意味を表示します。"}</p>
                    </div>
                    {selectedWord ? <span className="glossaryStatusBadge">{glossaryStatus}</span> : null}
                  </div>
                  {selectedWord ? (
                    <>
                      <p className="glossaryMeaning">{glossaryMeaning || "意味を表示します。"}</p>
                      {glossaryMeta ? <p className="glossaryMeta">{glossaryMeta}</p> : null}
                    </>
                  ) : (
                    <p className="glossaryEmptyMessage">字幕内の単語を選ぶと、このパネルに意味が表示されます。</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="learningEmptyCard">
                <h3>字幕を選択してください</h3>
                <p>一覧から字幕をタップすると、単語の意味をすぐに確認できます。</p>
              </div>
            )}
          </section>

          <section className="learningSection">
            <div className="learningSectionHeader">
              <div>
                <h2>重要表現</h2>
                <p>字幕から抽出された表現を保存・除外・習得済みに切り替えられます。</p>
              </div>
            </div>
            {expressionStatusErrorById.__load__ ? (
              <div className="learningInlineError" role="alert">
                {expressionStatusErrorById.__load__}
              </div>
            ) : null}
            {expressions.length === 0 ? (
              <div className="learningEmptyCard">
                <h3>重要表現はまだありません</h3>
                <p>pipeline が完了すると、ここに学習候補が表示されます。</p>
              </div>
            ) : (
              <div className="expressionGrid">
                {expressions.map((expression) => {
                  const status = userExpressionStatuses[expression.id] ?? "";
                  const isUpdating = expressionStatusLoadingId === expression.id;
                  const updateError = expressionStatusErrorById[expression.id] ?? "";
                  const firstOccurrence = expression.occurrences[0];
                  return (
                    <article key={expression.id} className="expressionCard">
                      <div className="expressionCardHeader">
                        <div>
                          <h3>{expression.expressionText}</h3>
                        </div>
                        <span className={`expressionStatusBadge ${status || "unset"}`}>
                          {getExpressionStatusLabel(status)}
                        </span>
                      </div>
                      <dl className="expressionDetails">
                        <div>
                          <dt>意味</dt>
                          <dd>{expression.meaningJa}</dd>
                        </div>
                        <div>
                          <dt>例文</dt>
                          <dd>{expression.scenarioExample}</dd>
                        </div>
                      </dl>
                      <div className="expressionCardActions">
                        <button
                          type="button"
                          className="secondaryActionButton"
                          onClick={() => {
                            if (firstOccurrence) {
                              seekToSegment(firstOccurrence.startMs);
                            }
                          }}
                          disabled={!firstOccurrence}
                        >
                          該当シーン再生
                        </button>
                        {isUpdating ? <p className="expressionUpdating">更新中...</p> : null}
                      </div>
                      {updateError ? <p className="learningInlineError" role="alert">{updateError}</p> : null}
                      <div className="statusActions">
                        <button
                          type="button"
                          className={status === "saved" ? "active" : ""}
                          aria-pressed={status === "saved"}
                          disabled={isUpdating}
                          onClick={() => handleExpressionStatusAction(expression.id, "saved", status)}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className={status === "ignored" ? "active" : ""}
                          aria-pressed={status === "ignored"}
                          disabled={isUpdating}
                          onClick={() => handleExpressionStatusAction(expression.id, "ignored", status)}
                        >
                          除外
                        </button>
                        <button
                          type="button"
                          className={status === "mastered" ? "active" : ""}
                          aria-pressed={status === "mastered"}
                          disabled={isUpdating}
                          onClick={() => handleExpressionStatusAction(expression.id, "mastered", status)}
                        >
                          習得
                        </button>
                      </div>
                    </article>
                  );
                })}
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
