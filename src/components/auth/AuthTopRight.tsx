"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  completeGoogleRedirectSignIn,
  getFirebaseAuthErrorCode,
  getFirebaseAuthErrorMessage,
  signInAnonymouslyIfNeeded,
  signInWithGoogle,
  subscribeAuthState,
} from "@/lib/firebase/auth";

export function AuthTopRight() {
  const [uid, setUid] = useState<string>("");
  const [isAnonymous, setIsAnonymous] = useState<boolean>(true);
  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [errorCode, setErrorCode] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("匿名ユーザーを準備中です。");

  function applyUserState(user: User | null, nextStatusMessage?: string): void {
    setUid(user?.uid ?? "");
    setIsAnonymous(user?.isAnonymous ?? true);
    setEmail(user?.email ?? "");
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
      return `Googleアカウントでログイン中です${user.email ? `: ${user.email}` : "。"}`;
    });
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
              : "Googleアカウントでログインしました。",
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
        setError(redirectError instanceof Error ? redirectError.message : "Googleログインに失敗しました。");
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
          : "Googleアカウントでログインしました。",
      );
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Googleログインに失敗しました。");
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
      <div className="authStatusText">{statusMessage}</div>
      {isAnonymous ? (
        <button type="button" className="googleLoginButton" onClick={() => void handleGoogleSignIn()} disabled={loading}>
          {loading ? "Googleログイン中..." : "Googleでログイン"}
        </button>
      ) : (
        <div className="googleLoginDone">Googleログイン済み{email ? `: ${email}` : ""}</div>
      )}
      {uid ? <div className="authUid">uid: {uid}</div> : null}
      {error ? <div className="authError" role="alert">{error}</div> : null}
      {error ? <div className="authError">debug code: {errorCode || "unknown"}</div> : null}
    </div>
  );
}
