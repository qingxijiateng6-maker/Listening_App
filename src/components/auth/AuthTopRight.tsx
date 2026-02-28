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

  useEffect(() => {
    setError(getFirebaseAuthErrorMessage());

    const unsubscribe = subscribeAuthState((user) => {
      setUid(user?.uid ?? "");
      setIsAnonymous(user?.isAnonymous ?? true);
      setEmail(user?.email ?? "");
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
      await signInWithGoogle();
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Googleログインに失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authTopRight">
      {isAnonymous ? (
        <button type="button" className="googleLoginButton" onClick={() => void handleGoogleSignIn()} disabled={loading}>
          {loading ? "Googleログイン中..." : "Googleでログイン"}
        </button>
      ) : (
        <div className="googleLoginDone">Googleログイン済み{email ? `: ${email}` : ""}</div>
      )}
      {uid ? <div className="authUid">uid: {uid}</div> : null}
      {error ? <div className="authError">{error}</div> : null}
    </div>
  );
}
