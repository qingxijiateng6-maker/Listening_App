"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildAuthenticatedRequestHeaders } from "@/lib/firebase/auth";
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

type MaterialStatusResponse = {
  error?: string;
  status?: MaterialStatus;
  material?: {
    pipelineState?: PipelineState;
  };
};

const PREPARE_POLL_INTERVAL_MS = 1500;
const CONTINUE_CONFIRM_DELAY_MS = 120_000;

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
          if (payload.status === "ready") {
            router.replace(`/materials/${payload.materialId}`);
            return;
          }

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
    if (!materialId || error || showContinuePrompt) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    async function pollPrepare() {
      try {
        const authHeaders = await buildAuthenticatedRequestHeaders();
        const response = await fetch(`/api/materials/${materialId}`, {
          method: "GET",
          headers: authHeaders,
        });

        const payload = await readJsonResponse<MaterialStatusResponse>(response);
        if (!response.ok) {
          throw new Error(payload?.error ?? "字幕の準備状況を確認できませんでした。");
        }

        if (cancelled) {
          return;
        }

        setLoadingMessage(buildLoadingMessage(payload?.status, payload?.material?.pipelineState));

        if (payload?.status === "ready") {
          router.replace(`/materials/${materialId}`);
          return;
        }

        if (payload?.status === "failed" || payload?.status === "cancelled") {
          setError(
            buildPrepareErrorMessage({
              error: payload.error,
              status: payload.status,
              pipelineState: payload.material?.pipelineState,
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
  }, [error, materialId, router, showContinuePrompt]);

  useEffect(() => {
    if (!materialId || error || showContinuePrompt || hasShownContinuePrompt) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setHasShownContinuePrompt(true);
      setShowContinuePrompt(true);
    }, CONTINUE_CONFIRM_DELAY_MS);

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
            <p id="continue-caption-title">字幕取得に時間がかかってしまいます。字幕生成を継続しますか？</p>
            <p id="continue-caption-body">「はい」で待機を継続し、「トップへ戻る」で待機画面を閉じます。字幕生成はバックグラウンドで継続します。</p>
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
