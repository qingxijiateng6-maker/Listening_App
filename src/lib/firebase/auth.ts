import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  linkWithRedirect,
  onAuthStateChanged,
  signInWithRedirect,
  signInWithPopup,
  signInAnonymously,
  signOut,
  type AuthError,
  type Unsubscribe,
  type User,
} from "firebase/auth";
import { getFirebaseClientError, tryGetFirebaseApp } from "@/lib/firebase/client";

type FirebaseAuthDebugError = Error & {
  firebaseAuthCode?: string;
};

let firebaseAuthError: FirebaseAuthDebugError | null = null;
const GOOGLE_AUTH_REDIRECT_METHOD_KEY = "listening-app-google-auth-redirect-method";
const GOOGLE_POPUP_TIMEOUT_MS = 8000;
const GOOGLE_REDIRECT_FALLBACK_ERROR_CODES = new Set([
  "auth/popup-blocked",
  "auth/cancelled-popup-request",
  "auth/operation-not-supported-in-this-environment",
  "auth/popup-timeout",
]);

export type GoogleSignInResult = {
  user: User | null;
  method: "linked" | "signed_in" | "redirect";
};

function setFirebaseAuthError(error: FirebaseAuthDebugError | null): void {
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

function toFirebaseAuthError(error: unknown): FirebaseAuthDebugError {
  if (error instanceof Error) {
    const nextError = new Error(getFirebaseAuthActionErrorMessage(error)) as FirebaseAuthDebugError;
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    if (code) {
      nextError.firebaseAuthCode = code;
    }
    return nextError;
  }
  if (error && typeof error === "object") {
    const authError = error as Partial<AuthError>;
    const nextError = new Error(
      getFirebaseAuthActionErrorMessage({
        name: authError.name ?? "FirebaseAuthError",
        message: authError.message ?? "",
        code: authError.code ?? "",
      } as AuthError),
    ) as FirebaseAuthDebugError;
    if (typeof authError.code === "string" && authError.code.length > 0) {
      nextError.firebaseAuthCode = authError.code;
    }
    return nextError;
  }

  return new Error("認証を初期化できません。") as FirebaseAuthDebugError;
}

function createPopupTimeoutError(): AuthError {
  return {
    name: "FirebaseAuthError",
    message: "Googleログインのポップアップ応答がタイムアウトしました。",
    code: "auth/popup-timeout",
  } as AuthError;
}

async function withGooglePopupTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(createPopupTimeoutError());
        }, GOOGLE_POPUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function persistRedirectMethod(method: "linked" | "signed_in"): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(GOOGLE_AUTH_REDIRECT_METHOD_KEY, method);
}

function readAndClearRedirectMethod(): "linked" | "signed_in" {
  if (typeof window === "undefined") {
    return "signed_in";
  }

  const method = window.sessionStorage.getItem(GOOGLE_AUTH_REDIRECT_METHOD_KEY);
  window.sessionStorage.removeItem(GOOGLE_AUTH_REDIRECT_METHOD_KEY);
  return method === "linked" ? "linked" : "signed_in";
}

async function fallbackToGoogleRedirect(
  currentUser: User | null,
  provider: GoogleAuthProvider,
  method: "linked" | "signed_in",
): Promise<GoogleSignInResult> {
  persistRedirectMethod(method);

  if (currentUser && method === "linked") {
    await linkWithRedirect(currentUser, provider);
  } else {
    const auth = getFirebaseAuth();
    if (!auth) {
      throw getFirebaseAuthError() ?? new Error("認証を初期化できません。");
    }
    await signInWithRedirect(auth, provider);
  }

  return {
    user: currentUser,
    method: "redirect",
  };
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

export function getFirebaseAuthError(): FirebaseAuthDebugError | null {
  const clientError = getFirebaseClientError();
  if (firebaseAuthError) {
    return firebaseAuthError;
  }
  if (!clientError) {
    return null;
  }
  return clientError as FirebaseAuthDebugError;
}

export function getFirebaseAuthErrorMessage(): string {
  return getFirebaseAuthError()?.message ?? "";
}

export function getFirebaseAuthErrorCode(): string {
  return getFirebaseAuthError()?.firebaseAuthCode ?? "unknown";
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

export async function signOutToAnonymous(): Promise<User | null> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw getFirebaseAuthError() ?? new Error("認証を初期化できません。");
  }

  try {
    await signOut(auth);
    setFirebaseAuthError(null);
  } catch (error) {
    const authError = toFirebaseAuthError(error);
    setFirebaseAuthError(authError);
    throw authError;
  }

  const anonymousUser = await signInAnonymouslyIfNeeded();
  if (!anonymousUser) {
    throw getFirebaseAuthError() ?? new Error("匿名ユーザーの再初期化に失敗しました。");
  }

  return anonymousUser;
}

export async function ensureAnonymousSession(): Promise<User | null> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw getFirebaseAuthError() ?? new Error("認証を初期化できません。");
  }

  if (auth.currentUser?.isAnonymous) {
    return auth.currentUser;
  }

  if (auth.currentUser) {
    return signOutToAnonymous();
  }

  const anonymousUser = await signInAnonymouslyIfNeeded();
  if (!anonymousUser) {
    throw getFirebaseAuthError() ?? new Error("匿名ユーザーの再初期化に失敗しました。");
  }

  return anonymousUser;
}

export async function completeGoogleRedirectSignIn(): Promise<GoogleSignInResult | null> {
  const auth = getFirebaseAuth();
  if (!auth) {
    return null;
  }

  try {
    const credential = await getRedirectResult(auth);
    if (!credential) {
      return null;
    }

    setFirebaseAuthError(null);
    return {
      user: credential.user,
      method: readAndClearRedirectMethod(),
    };
  } catch (error) {
    readAndClearRedirectMethod();
    const nextError = toFirebaseAuthError(error);
    setFirebaseAuthError(nextError);
    throw nextError;
  }
}

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw getFirebaseAuthError() ?? new Error("認証を初期化できません。");
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    if (auth.currentUser?.isAnonymous) {
      await signOut(auth);
    }

    const credential = await withGooglePopupTimeout(signInWithPopup(auth, provider));
    setFirebaseAuthError(null);
    return {
      user: credential.user,
      method: "signed_in",
    };
  } catch (error) {
    const authError = error as AuthError;
    if (GOOGLE_REDIRECT_FALLBACK_ERROR_CODES.has(authError.code)) {
      return fallbackToGoogleRedirect(null, provider, "signed_in");
    }

    const nextError = toFirebaseAuthError(error);
    setFirebaseAuthError(nextError);
    throw nextError;
  }
}
