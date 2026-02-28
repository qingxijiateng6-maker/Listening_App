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

function setFirebaseAuthError(error: Error | null): void {
  firebaseAuthError = error;
}

function toFirebaseAuthError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
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

export async function signInWithGoogle(): Promise<User> {
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
      return credential.user;
    } catch (error) {
      const authError = error as AuthError;
      if (
        authError.code === "auth/credential-already-in-use" ||
        authError.code === "auth/provider-already-linked"
      ) {
        const credential = await signInWithPopup(auth, provider);
        setFirebaseAuthError(null);
        return credential.user;
      }

      setFirebaseAuthError(toFirebaseAuthError(error));
      throw error;
    }
  }

  try {
    const credential = await signInWithPopup(auth, provider);
    setFirebaseAuthError(null);
    return credential.user;
  } catch (error) {
    setFirebaseAuthError(toFirebaseAuthError(error));
    throw error;
  }
}
