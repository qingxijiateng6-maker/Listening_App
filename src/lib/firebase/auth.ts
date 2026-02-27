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
import { getFirebaseApp } from "@/lib/firebase/client";

export function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}

export async function signInAnonymouslyIfNeeded(): Promise<User | null> {
  const auth = getFirebaseAuth();
  if (auth.currentUser) {
    return auth.currentUser;
  }
  const credential = await signInAnonymously(auth);
  return credential.user;
}

export function subscribeAuthState(callback: (user: User | null) => void): Unsubscribe {
  const auth = getFirebaseAuth();
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle(): Promise<User> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  if (auth.currentUser?.isAnonymous) {
    try {
      const credential = await linkWithPopup(auth.currentUser, provider);
      return credential.user;
    } catch (error) {
      const authError = error as AuthError;
      if (
        authError.code === "auth/credential-already-in-use" ||
        authError.code === "auth/provider-already-linked"
      ) {
        const credential = await signInWithPopup(auth, provider);
        return credential.user;
      }
      throw error;
    }
  }

  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}
