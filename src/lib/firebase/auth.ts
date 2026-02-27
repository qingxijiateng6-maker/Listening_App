import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
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
