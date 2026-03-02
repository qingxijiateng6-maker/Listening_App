"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  completeGoogleRedirectSignIn,
  ensureAnonymousSession,
  getFirebaseAuthErrorCode,
  getFirebaseAuthErrorMessage,
  signInAnonymouslyIfNeeded,
  signOutToAnonymous,
  signInWithGoogle,
  subscribeAuthState,
} from "@/lib/firebase/auth";

export function AuthTopRight() {
  const [isAnonymous, setIsAnonymous] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [errorCode, setErrorCode] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("匿名ユーザーを準備中です。");

  function applyUserState(user: User | null, nextStatusMessage?: string): void {
    setIsAnonymous(user?.isAnonymous ?? true);
    setStatusMessage(() => {
      if (nextStatusMessage) {
        return nextStatusMessage;
      }
      if (!user) {
        return "ログイン状態を確認中です。";
      }
      if (user.isAnonymous) {
        return "匿名ゲストとして利用中です。";
      }
      return "";
    });
  }

  async function restoreAnonymousDashboard(): Promise<void> {
    const anonymousUser = await ensureAnonymousSession();
    applyUserState(anonymousUser, "匿名ゲストとして利用中です。");
  }

  useEffect(() => {
    setError(getFirebaseAuthErrorMessage());
    setErrorCode(getFirebaseAuthErrorCode());

    const unsubscribe = subscribeAuthState((user) => {
      applyUserState(user);
      setError((currentError) => (currentError || !user ? getFirebaseAuthErrorMessage() : ""));
      setErrorCode((currentCode) => (currentCode || !user ? getFirebaseAuthErrorCode() : ""));
    });

    void (async () => {
      try {
        const redirectResult = await completeGoogleRedirectSignIn();
        if (redirectResult?.user) {
          applyUserState(
            redirectResult.user,
            redirectResult.method === "linked"
              ? "匿名ユーザーをGoogleアカウントに連携しました。"
              : "",
          );
          setError("");
          setErrorCode("");
          return;
        }

        const anonymousUser = await signInAnonymouslyIfNeeded();
        if (anonymousUser?.isAnonymous) {
          applyUserState(anonymousUser);
        }
        setError((currentError) => {
          const nextError = getFirebaseAuthErrorMessage();
          return nextError || currentError;
        });
        setErrorCode((currentCode) => {
          const nextCode = getFirebaseAuthErrorCode();
          return nextCode !== "unknown" ? nextCode : currentCode;
        });
      } catch (redirectError) {
        await restoreAnonymousDashboard();
        setError("ログインに失敗しました。");
        setErrorCode(getFirebaseAuthErrorCode());
      }
    })();

    return () => {
      unsubscribe();
    };
  }, []);

  async function handleGoogleSignIn(): Promise<void> {
    setError("");
    setErrorCode("");
    setLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result.method === "redirect") {
        setStatusMessage("Googleログイン画面へ移動しています。");
        return;
      }

      applyUserState(
        result.user,
        result.method === "linked"
          ? "匿名ユーザーをGoogleアカウントに連携しました。"
          : "",
      );
    } catch (signInError) {
      await restoreAnonymousDashboard();
      setError("ログインに失敗しました。");
      setErrorCode(getFirebaseAuthErrorCode());
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    setError("");
    setErrorCode("");
    setLoading(true);
    try {
      const anonymousUser = await signOutToAnonymous();
      applyUserState(anonymousUser, "Googleアカウントからログアウトしました。");
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "ログアウトに失敗しました。");
      setErrorCode(getFirebaseAuthErrorCode());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authTopRight">
      <div className={`authStatusBadge ${isAnonymous ? "anonymous" : "authenticated"}`}>
        {isAnonymous ? "状態: 匿名ゲスト" : "状態: Googleログイン済み"}
      </div>
      {statusMessage ? <div className="authStatusText">{statusMessage}</div> : null}
      {isAnonymous ? (
        <button type="button" className="googleLoginButton" onClick={() => void handleGoogleSignIn()} disabled={loading}>
          {loading ? "Googleログイン中..." : "Googleでログイン"}
        </button>
      ) : (
        <>
          <button type="button" className="secondaryActionButton" onClick={() => void handleSignOut()} disabled={loading}>
            {loading ? "ログアウト中..." : "ログアウト"}
          </button>
        </>
      )}
      {error ? <div className="authError" role="alert">{error}</div> : null}
      {error ? <div className="authError">debug code: {errorCode || "unknown"}</div> : null}
    </div>
  );
}
