"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildAuthenticatedRequestHeaders } from "@/lib/firebase/auth";
import { MATERIAL_PREPARE_CONTINUATION_CONFIRMATION_AFTER_MS } from "@/lib/constants";
import type { MaterialStatus } from "@/types/domain";

type CreateMaterialResponse = {
  error?: string;
  materialId?: string;
  status?: MaterialStatus;
};

type PipelineState = {
  currentStep?: "meta" | "captions" | "format";
  lastCompletedStep?: "meta" | "captions" | "format" | null;
  status?: MaterialStatus;
  updatedAt?: string | null;
  errorCode?: string;
  errorMessage?: string;
};

type PrepareMaterialResponse = {
  error?: string;
  status?: MaterialStatus;
  pipelineState?: PipelineState;
  shouldContinuePolling?: boolean;
};

type MaterialSegmentsResponse = {
  error?: string;
  segments?: Array<{
    segmentId: string;
    startMs: number;
    endMs: number;
    text: string;
  }>;
};

const PREPARE_POLL_INTERVAL_MS = 1500;

function buildLoadingMessage(status: MaterialStatus | undefined, pipelineState: PipelineState | undefined): string {
  if (status === "failed") {
    return pipelineState?.errorMessage?.trim() || "字幕の準備に失敗しました。";
  }

  switch (pipelineState?.currentStep) {
    case "meta":
      return "動画情報を確認しています...";
    case "captions":
      return "字幕を取得しています...";
    case "format":
      return "学習画面を仕上げています...";
    default:
      return "字幕を準備しています...";
  }
}

function buildPrepareErrorMessage(payload: PrepareMaterialResponse): string {
  const errorCode = payload.pipelineState?.errorCode ?? "";
  if (errorCode.includes("captions_not_found")) {
    return "この動画では字幕を取得できませんでした。字幕が利用できる公開動画で再度お試しください。";
  }
  if (errorCode.includes("captions_provider_not_configured")) {
    return "字幕取得の設定に失敗しているため、字幕を準備できませんでした。";
  }
  if (errorCode.includes("captions_provider_failed")) {
    return "字幕の取得に失敗しました。時間を置いて再度お試しください。";
  }
  if (errorCode.includes("formatted_segments_empty")) {
    return "字幕は取得できましたが、学習画面に必要な字幕データを生成できませんでした。";
  }
  if (payload.error?.trim()) {
    return payload.error;
  }
  if (payload.pipelineState?.errorMessage?.trim()) {
    return payload.pipelineState.errorMessage;
  }
  if (payload.status === "failed") {
    return "字幕の準備に失敗しました。時間を置いて再度お試しください。";
  }
  return "字幕の準備を完了できませんでした。";
}

async function fetchMaterialSegments(
  materialId: string,
  authHeaders: Record<string, string>,
): Promise<number> {
  const response = await fetch(`/api/materials/${materialId}/segments`, {
    method: "GET",
    headers: authHeaders,
  });

  const payload = await readJsonResponse<MaterialSegmentsResponse>(response);
  if (!response.ok) {
    throw new Error(payload?.error ?? "字幕データを確認できませんでした。");
  }

  return payload?.segments?.length ?? 0;
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const responseWithText = response as Response & { text?: () => Promise<string> };
  if (typeof responseWithText.text === "function") {
    try {
      const body = await responseWithText.text();
      if (!body.trim()) {
        return null;
      }
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  }

  const responseWithJson = response as Response & { json?: () => Promise<unknown> };
  if (typeof responseWithJson.json === "function") {
    try {
      return (await responseWithJson.json()) as T;
    } catch {
      return null;
    }
  }

  return null;
}

export function MaterialRegistrationLoadingScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const youtubeUrl = searchParams?.get("youtubeUrl")?.trim() ?? "";
  const initialMaterialId = searchParams?.get("materialId")?.trim() ?? "";
  const [error, setError] = useState("");
  const [materialId, setMaterialId] = useState(initialMaterialId);
  const [loadingMessage, setLoadingMessage] = useState("動画を登録して、字幕を準備しています。");
  const [showContinuePrompt, setShowContinuePrompt] = useState(false);
  const [hasShownContinuePrompt, setHasShownContinuePrompt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (materialId) {
      return () => {
        cancelled = true;
      };
    }

    async function registerMaterial() {
      if (!youtubeUrl) {
        setError("YouTube公開動画のURL形式で入力してください。");
        return;
      }

      try {
        const authHeaders = await buildAuthenticatedRequestHeaders();
        const response = await fetch("/api/materials", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({ youtubeUrl }),
        });

        const payload = await readJsonResponse<CreateMaterialResponse>(response);
        if (!response.ok || !payload?.materialId) {
          throw new Error(payload?.error ?? "動画登録に失敗しました。");
        }

        if (!cancelled) {
          setMaterialId(payload.materialId);
          setLoadingMessage(buildLoadingMessage(payload.status, undefined));
        }
      } catch (registrationError) {
        if (!cancelled) {
          setError(registrationError instanceof Error ? registrationError.message : "動画登録に失敗しました。");
        }
      }
    }

    void registerMaterial();

    return () => {
      cancelled = true;
    };
  }, [materialId, router, youtubeUrl]);

  useEffect(() => {
    if (!materialId || error) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    async function pollPrepare() {
      try {
        const authHeaders = await buildAuthenticatedRequestHeaders();
        const response = await fetch(`/api/materials/${materialId}/prepare`, {
          method: "POST",
          headers: authHeaders,
        });

        const payload = await readJsonResponse<PrepareMaterialResponse>(response);
        if (!response.ok) {
          throw new Error(payload?.error ?? "字幕の準備状況を確認できませんでした。");
        }

        if (cancelled) {
          return;
        }

        setLoadingMessage(buildLoadingMessage(payload?.status, payload?.pipelineState));

        if (payload?.status === "ready") {
          const segmentCount = await fetchMaterialSegments(materialId, authHeaders);
          if (cancelled) {
            return;
          }
          if (segmentCount <= 0) {
            setError("字幕データが見つかりませんでした。トップから再度登録してください。");
            return;
          }
          router.replace(`/materials/${materialId}`);
          return;
        }

        if (payload?.status === "failed" || payload?.status === "cancelled") {
          setError(
            buildPrepareErrorMessage({
              error: payload.error,
              status: payload.status,
              pipelineState: payload.pipelineState,
            }),
          );
          return;
        }

        timeoutId = window.setTimeout(() => {
          void pollPrepare();
        }, PREPARE_POLL_INTERVAL_MS);
      } catch (prepareError) {
        if (!cancelled) {
          setError(prepareError instanceof Error ? prepareError.message : "字幕の準備に失敗しました。");
        }
      }
    }

    void pollPrepare();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [error, materialId, router]);

  useEffect(() => {
    if (!materialId || error || showContinuePrompt || hasShownContinuePrompt) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setHasShownContinuePrompt(true);
      setShowContinuePrompt(true);
    }, MATERIAL_PREPARE_CONTINUATION_CONFIRMATION_AFTER_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [error, hasShownContinuePrompt, materialId, showContinuePrompt]);

  function handleReturnHome(): void {
    router.replace("/");
  }

  if (error) {
    return (
      <main>
        <section className="learningStateCard error">
          <h2>登録エラー</h2>
          <p>{error}</p>
          <p className="learningBackLink">
            <Link href="/">トップへ戻る</Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main>
      <section className="learningStateCard loading" aria-live="polite">
        <h2>読み込み中です...</h2>
        <p>{loadingMessage}</p>
        {showContinuePrompt ? (
          <div role="alertdialog" aria-labelledby="continue-caption-title" aria-describedby="continue-caption-body">
            <p id="continue-caption-title">字幕取得に時間がかかっています。待機画面をこのまま開きますか？</p>
            <p id="continue-caption-body">「はい」でこの画面の表示を続け、「トップへ戻る」で待機画面を閉じます。字幕生成はバックグラウンドでも継続します。</p>
            <div>
              <button type="button" className="primaryCtaButton" onClick={() => setShowContinuePrompt(false)}>
                はい
              </button>
              <button type="button" className="secondaryActionButton" onClick={handleReturnHome}>
                トップへ戻る
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
