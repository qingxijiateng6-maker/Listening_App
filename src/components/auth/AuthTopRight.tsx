"use client";

import { useEffect, useState } from "react";
import {
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
  const [statusMessage, setStatusMessage] = useState<string>("匿名ユーザーを準備中です。");

  useEffect(() => {
    setError(getFirebaseAuthErrorMessage());

    const unsubscribe = subscribeAuthState((user) => {
      setUid(user?.uid ?? "");
      setIsAnonymous(user?.isAnonymous ?? true);
      setEmail(user?.email ?? "");
      setStatusMessage(() => {
        if (!user) {
          return "ログイン状態を確認中です。";
        }
        if (user.isAnonymous) {
          return "匿名ゲストとして利用中です。";
        }
        return `Googleアカウントでログイン中です${user.email ? `: ${user.email}` : "。"}`;
      });
      setError((currentError) => (currentError || !user ? getFirebaseAuthErrorMessage() : ""));
    });

    void signInAnonymouslyIfNeeded().then(() => {
      setError((currentError) => {
        const nextError = getFirebaseAuthErrorMessage();
        return nextError || currentError;
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  async function handleGoogleSignIn(): Promise<void> {
    setError("");
    setLoading(true);
    try {
      const result = await signInWithGoogle();
      setStatusMessage(
        result.method === "linked"
          ? "匿名ユーザーをGoogleアカウントに連携しました。"
          : "Googleアカウントでログインしました。",
      );
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Googleログインに失敗しました。");
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
    </div>
  );
}
