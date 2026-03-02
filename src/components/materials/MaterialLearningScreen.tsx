"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Material, Segment } from "@/types/domain";
import { YouTubeIFramePlayer } from "@/components/materials/YouTubeIFramePlayer";
import { buildAuthenticatedRequestHeaders } from "@/lib/firebase/auth";

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

type SavedExpressionRecord = {
  expressionId: string;
  expression: string;
  meaning: string;
  exampleSentence: string;
};

type ExpressionsApiResponse = {
  expressions: SavedExpressionRecord[];
};

function normalizeSavedExpression(record: Partial<SavedExpressionRecord>): SavedExpressionRecord {
  return {
    expressionId: typeof record.expressionId === "string" ? record.expressionId : "",
    expression: typeof record.expression === "string" ? record.expression : "",
    meaning: typeof record.meaning === "string" ? record.meaning : "",
    exampleSentence: typeof record.exampleSentence === "string" ? record.exampleSentence : "",
  };
}

function hasVisibleExpressionContent(record: Partial<SavedExpressionRecord>): boolean {
  const normalized = normalizeSavedExpression(record);
  return (
    normalized.expression.trim().length > 0 &&
    normalized.meaning.trim().length > 0 &&
    normalized.exampleSentence.trim().length > 0
  );
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
  const [savedExpressions, setSavedExpressions] = useState<SavedExpressionRecord[]>([]);
  const [playerApi, setPlayerApi] = useState<PlayerApi | null>(null);
  const [currentMs, setCurrentMs] = useState<number>(0);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [expressionError, setExpressionError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingLabel, setLoadingLabel] = useState<string>("教材データを読み込んでいます...");
  const [formExpression, setFormExpression] = useState<string>("");
  const [formMeaning, setFormMeaning] = useState<string>("");
  const [formExampleSentence, setFormExampleSentence] = useState<string>("");
  const [isSavingExpression, setIsSavingExpression] = useState<boolean>(false);
  const [deletingExpressionId, setDeletingExpressionId] = useState<string>("");
  const playerSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function fetchJson<T>(url: string): Promise<T> {
      const authHeaders = await buildAuthenticatedRequestHeaders();
      const response = await fetch(url, {
        method: "GET",
        headers: authHeaders,
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

        const normalizedExpressions = expressionsPayload.expressions.map((expression) => normalizeSavedExpression(expression));
        const visibleExpressions = normalizedExpressions.filter((expression) => hasVisibleExpressionContent(expression));
        const blankExpressions = normalizedExpressions.filter(
          (expression) => expression.expressionId && !hasVisibleExpressionContent(expression),
        );

        setMaterial(materialPayload.material);
        setSegments(nextSegments);
        setSavedExpressions(visibleExpressions);
        setSelectedSegmentId(nextSegments[0]?.id ?? "");

        if (blankExpressions.length > 0) {
          const authHeaders = await buildAuthenticatedRequestHeaders();
          void Promise.allSettled(
            blankExpressions.map((expression) =>
              fetch(`/api/materials/${materialId}/expressions/${expression.expressionId}`, {
                method: "DELETE",
                headers: authHeaders,
              }),
            ),
          );
        }
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
  const expressionMatches = useMemo(() => {
    return Object.fromEntries(
      savedExpressions.map((savedExpression) => {
        const normalized = normalizeSavedExpression(savedExpression).expression.trim().toLocaleLowerCase();
        const matches =
          normalized.length === 0
            ? []
            : segments.filter((segment) => segment.text.toLocaleLowerCase().includes(normalized));
        return [savedExpression.expressionId, matches];
      }),
    ) as Record<string, SegmentWithId[]>;
  }, [savedExpressions, segments]);

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

  function focusVideoArea(): void {
    playerSectionRef.current?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
  }

  async function handleSaveExpression(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const expression = formExpression.trim();
    const meaning = formMeaning.trim();
    const exampleSentence = formExampleSentence.trim();

    if (!expression || !meaning || !exampleSentence) {
      setExpressionError("表現・意味・例文をすべて入力してください。");
      return;
    }

    setIsSavingExpression(true);
    setExpressionError("");
    try {
      const authHeaders = await buildAuthenticatedRequestHeaders();
      const response = await fetch(`/api/materials/${materialId}/expressions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          expression,
          meaning,
          exampleSentence,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "表現の保存に失敗しました。");
      }

      const payload = (await response.json()) as { expression: SavedExpressionRecord };
      const normalizedExpression = normalizeSavedExpression(payload.expression);
      if (hasVisibleExpressionContent(normalizedExpression)) {
        setSavedExpressions((current) => [...current, normalizedExpression]);
      }
      setFormExpression("");
      setFormMeaning("");
      setFormExampleSentence("");
    } catch (saveError) {
      setExpressionError(saveError instanceof Error ? saveError.message : "表現の保存に失敗しました。");
    } finally {
      setIsSavingExpression(false);
    }
  }

  async function handleDeleteExpression(expressionId: string): Promise<void> {
    setDeletingExpressionId(expressionId);
    setExpressionError("");
    try {
      const authHeaders = await buildAuthenticatedRequestHeaders();
      const response = await fetch(`/api/materials/${materialId}/expressions/${expressionId}`, {
        method: "DELETE",
        headers: authHeaders,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "表現の削除に失敗しました。");
      }

      setSavedExpressions((current) => current.filter((expression) => expression.expressionId !== expressionId));
    } catch (deleteError) {
      setExpressionError(deleteError instanceof Error ? deleteError.message : "表現の削除に失敗しました。");
    } finally {
      setDeletingExpressionId("");
    }
  }

  return (
    <main className="learningScreen">
      <div className="learningScreenGlow" aria-hidden="true" />
      <div className="learningScreenContent">
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
                <div ref={playerSectionRef} className="learningHeroSection playerColumn">
                  <div className="learningSectionHeader">
                    <div />
                  </div>
                  <YouTubeIFramePlayer
                    youtubeId={material.youtubeId}
                    onApiReady={handlePlayerReady}
                    onTimeChange={handleTimeChange}
                  />
                  <div className="expressionFormPanel">
                    <div className="learningSectionHeader compact">
                      <div>
                        <h3>表現を保存する</h3>
                      </div>
                    </div>
                    <form className="expressionForm" onSubmit={handleSaveExpression}>
                      <label className="expressionFieldLabel" htmlFor="expression-input">
                        保存する表現
                      </label>
                      <input
                        id="expression-input"
                        type="text"
                        value={formExpression}
                        onChange={(event) => setFormExpression(event.target.value)}
                        disabled={isSavingExpression}
                      />
                      <label className="expressionFieldLabel" htmlFor="meaning-input">
                        意味
                      </label>
                      <input
                        id="meaning-input"
                        type="text"
                        value={formMeaning}
                        onChange={(event) => setFormMeaning(event.target.value)}
                        disabled={isSavingExpression}
                      />
                      <label className="expressionFieldLabel" htmlFor="example-sentence-input">
                        例文
                      </label>
                      <textarea
                        id="example-sentence-input"
                        className="expressionTextarea"
                        value={formExampleSentence}
                        onChange={(event) => setFormExampleSentence(event.target.value)}
                        disabled={isSavingExpression}
                        rows={4}
                      />
                      <button type="submit" className="primaryCtaButton" disabled={isSavingExpression}>
                        {isSavingExpression ? "保存中..." : "保存"}
                      </button>
                    </form>
                  </div>
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
                            onClick={() => {
                              setSelectedSegmentId(segment.id);
                              seekToSegment(segment.startMs);
                            }}
                          >
                            <span className="segmentTime">[{(segment.startMs / 1000).toFixed(1)}s]</span>
                            <span className="segmentText">{segment.text}</span>
                            <span className="segmentStateText">{isActive ? "再生中" : isSelected ? "選択中" : ""}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="subtitleTapPanel">
                <div className="learningSectionHeader compact">
                  <div>
                    <h3>選択中の字幕</h3>
                    <p>{selectedSegment ? selectedSegment.text : "一覧から字幕をタップすると、その位置から動画を再生できます。"}</p>
                  </div>
                  {selectedSegment ? (
                    <button
                      type="button"
                      className="secondaryActionButton"
                      onClick={() => {
                        seekToSegment(selectedSegment.startMs);
                      }}
                    >
                      この位置から再生
                    </button>
                  ) : null}
                </div>
                {expressionError ? (
                  <div className="learningInlineError" role="alert">
                    {expressionError}
                  </div>
                ) : null}
                <div className="savedExpressionsSection">
                  <div className="learningSectionHeader compact">
                    <div>
                      <h3>保存された表現</h3>
                    </div>
                  </div>
                  {savedExpressions.length === 0 ? (
                    <div className="learningEmptyCard compact">
                      <h3>まだ表現は保存されていません</h3>
                      <p>動画下のフォームから、この動画で学習したい表現を追加できます。</p>
                    </div>
                  ) : (
                    <div className="savedExpressionsList">
                      {savedExpressions.map((savedExpression) => {
                        const matches = expressionMatches[savedExpression.expressionId] ?? [];
                        return (
                          <article key={savedExpression.expressionId} className="savedExpressionCard">
                            <div className="savedExpressionBody">
                              <dl className="savedExpressionDetails">
                                <div>
                                  <dt>表現</dt>
                                  <dd>{savedExpression.expression}</dd>
                                </div>
                                <div>
                                  <dt>意味</dt>
                                  <dd>{savedExpression.meaning}</dd>
                                </div>
                                <div>
                                  <dt>例文</dt>
                                  <dd>{savedExpression.exampleSentence}</dd>
                                </div>
                              </dl>
                              <div className="savedExpressionScenes">
                                <span className="savedExpressionScenesTitle">この動画で使われているシーン</span>
                                {matches.length === 0 ? (
                                  <p className="savedExpressionSceneEmpty">
                                    この動画の字幕では、完全一致するシーンをまだ見つけられていません。
                                  </p>
                                ) : (
                                  <div className="savedExpressionSceneList">
                                    {matches.map((segment) => (
                                      <button
                                        key={`${savedExpression.expressionId}-${segment.id}`}
                                        type="button"
                                        className="savedExpressionSceneButton"
                                        onClick={() => {
                                          setSelectedSegmentId(segment.id);
                                          seekToSegment(segment.startMs);
                                          focusVideoArea();
                                        }}
                                      >
                                        [{(segment.startMs / 1000).toFixed(1)}s] {segment.text}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="secondaryActionButton savedExpressionDeleteButton"
                              onClick={() => {
                                void handleDeleteExpression(savedExpression.expressionId);
                              }}
                              disabled={deletingExpressionId === savedExpression.expressionId}
                            >
                              {deletingExpressionId === savedExpression.expressionId ? "削除中..." : "削除"}
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
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
      </div>
    </main>
  );
}
