import {
  GoogleAuthProvider,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
  signInWithPopup,
  signInAnonymously,
  type AuthError,
  type Unsubscribe,
  type User,
} from "firebase/auth";
import { getFirebaseClientError, tryGetFirebaseApp } from "@/lib/firebase/client";

let firebaseAuthError: Error | null = null;
const GOOGLE_LINK_FALLBACK_ERROR_CODES = new Set([
  "auth/credential-already-in-use",
  "auth/provider-already-linked",
]);

export type GoogleSignInResult = {
  user: User;
  method: "linked" | "signed_in";
};

function setFirebaseAuthError(error: Error | null): void {
  firebaseAuthError = error;
}

function getFirebaseAuthActionErrorMessage(error: AuthError | Error): string {
  const code = "code" in error ? error.code : undefined;

  switch (code) {
    case "auth/popup-closed-by-user":
      return "Googleログインがキャンセルされました。";
    case "auth/popup-blocked":
      return "Googleログインのポップアップがブロックされました。ブラウザ設定を確認してください。";
    case "auth/network-request-failed":
      return "ネットワークエラーのためGoogleログインに失敗しました。";
    case "auth/account-exists-with-different-credential":
      return "別のログイン方法で作成済みのアカウントです。";
    default:
      return error.message || "認証を初期化できません。";
  }
}

function toFirebaseAuthError(error: unknown): Error {
  if (error instanceof Error) {
    return new Error(getFirebaseAuthActionErrorMessage(error));
  }
  if (error && typeof error === "object") {
    const authError = error as Partial<AuthError>;
    return new Error(
      getFirebaseAuthActionErrorMessage({
        name: authError.name ?? "FirebaseAuthError",
        message: authError.message ?? "",
        code: authError.code ?? "",
      } as AuthError),
    );
  }

  return new Error("認証を初期化できません。");
}

export function getFirebaseAuth() {
  const app = tryGetFirebaseApp();
  if (!app) {
    const clientError = getFirebaseClientError() ?? new Error("認証を初期化できません。");
    setFirebaseAuthError(clientError);
    return null;
  }

  try {
    const auth = getAuth(app);
    setFirebaseAuthError(null);
    return auth;
  } catch (error) {
    const authError = toFirebaseAuthError(error);
    setFirebaseAuthError(authError);
    console.error("Failed to initialize Firebase auth.", error);
    return null;
  }
}

export function getFirebaseAuthError(): Error | null {
  return firebaseAuthError ?? getFirebaseClientError();
}

export function getFirebaseAuthErrorMessage(): string {
  return getFirebaseAuthError()?.message ?? "";
}

export async function buildAuthenticatedRequestHeaders(): Promise<Record<string, string>> {
  const user = await signInAnonymouslyIfNeeded();
  if (!user) {
    return {};
  }

  const headers: Record<string, string> = {
    "x-user-id": user.uid,
  };

  try {
    const idToken = await user.getIdToken();
    if (idToken) {
      headers.authorization = `Bearer ${idToken}`;
    }
  } catch {
    // The server still accepts x-user-id as a temporary fallback.
  }

  return headers;
}

export async function signInAnonymouslyIfNeeded(): Promise<User | null> {
  const auth = getFirebaseAuth();
  if (!auth) {
    return null;
  }

  if (auth.currentUser) {
    return auth.currentUser;
  }

  try {
    const credential = await signInAnonymously(auth);
    setFirebaseAuthError(null);
    return credential.user;
  } catch (error) {
    const authError = toFirebaseAuthError(error);
    setFirebaseAuthError(authError);
    console.error("Anonymous sign-in failed.", error);
    return null;
  }
}

export function subscribeAuthState(callback: (user: User | null) => void): Unsubscribe {
  const auth = getFirebaseAuth();
  if (!auth) {
    callback(null);
    return () => undefined;
  }

  try {
    return onAuthStateChanged(
      auth,
      (user) => {
        setFirebaseAuthError(null);
        callback(user);
      },
      (error) => {
        const authError = toFirebaseAuthError(error);
        setFirebaseAuthError(authError);
        console.error("Firebase auth state subscription failed.", error);
        callback(null);
      },
    );
  } catch (error) {
    const authError = toFirebaseAuthError(error);
    setFirebaseAuthError(authError);
    console.error("Failed to subscribe to Firebase auth state.", error);
    callback(null);
    return () => undefined;
  }
}

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw getFirebaseAuthError() ?? new Error("認証を初期化できません。");
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  if (auth.currentUser?.isAnonymous) {
    try {
      const credential = await linkWithPopup(auth.currentUser, provider);
      setFirebaseAuthError(null);
      return {
        user: credential.user,
        method: "linked",
      };
    } catch (error) {
      const authError = error as AuthError;
      if (GOOGLE_LINK_FALLBACK_ERROR_CODES.has(authError.code)) {
        try {
          const credential = await signInWithPopup(auth, provider);
          setFirebaseAuthError(null);
          return {
            user: credential.user,
            method: "signed_in",
          };
        } catch (signInError) {
          const nextError = toFirebaseAuthError(signInError);
          setFirebaseAuthError(nextError);
          throw nextError;
        }
      }

      const nextError = toFirebaseAuthError(error);
      setFirebaseAuthError(nextError);
      throw nextError;
    }
  }

  try {
    const credential = await signInWithPopup(auth, provider);
    setFirebaseAuthError(null);
    return {
      user: credential.user,
      method: "signed_in",
    };
  } catch (error) {
    const nextError = toFirebaseAuthError(error);
    setFirebaseAuthError(nextError);
    throw nextError;
  }
}
