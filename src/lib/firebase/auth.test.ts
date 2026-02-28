import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAuthMock = vi.fn();
const linkWithPopupMock = vi.fn();
const signInWithPopupMock = vi.fn();
const signInAnonymouslyMock = vi.fn();
const onAuthStateChangedMock = vi.fn();
const googleAuthProviderSetCustomParametersMock = vi.fn();
const tryGetFirebaseAppMock = vi.fn();
const getFirebaseClientErrorMock = vi.fn();

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {
    setCustomParameters(params: Record<string, string>) {
      googleAuthProviderSetCustomParametersMock(params);
    }
  },
  getAuth: (...args: Parameters<typeof getAuthMock>) => getAuthMock(...args),
  linkWithPopup: (...args: Parameters<typeof linkWithPopupMock>) => linkWithPopupMock(...args),
  onAuthStateChanged: (...args: Parameters<typeof onAuthStateChangedMock>) => onAuthStateChangedMock(...args),
  signInWithPopup: (...args: Parameters<typeof signInWithPopupMock>) => signInWithPopupMock(...args),
  signInAnonymously: (...args: Parameters<typeof signInAnonymouslyMock>) => signInAnonymouslyMock(...args),
}));

vi.mock("@/lib/firebase/client", () => ({
  tryGetFirebaseApp: () => tryGetFirebaseAppMock(),
  getFirebaseClientError: () => getFirebaseClientErrorMock(),
}));

import {
  getFirebaseAuthErrorMessage,
  signInAnonymouslyIfNeeded,
  signInWithGoogle,
  subscribeAuthState,
} from "@/lib/firebase/auth";

describe("firebase auth helpers", () => {
  beforeEach(() => {
    getAuthMock.mockReset();
    linkWithPopupMock.mockReset();
    signInWithPopupMock.mockReset();
    signInAnonymouslyMock.mockReset();
    onAuthStateChangedMock.mockReset();
    googleAuthProviderSetCustomParametersMock.mockReset();
    tryGetFirebaseAppMock.mockReset();
    getFirebaseClientErrorMock.mockReset();
    tryGetFirebaseAppMock.mockReturnValue({ name: "app" });
    getAuthMock.mockReturnValue({ currentUser: null });
    getFirebaseClientErrorMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("signs in anonymously only when no current user exists", async () => {
    const currentUser = { uid: "anon-uid", isAnonymous: true };
    getAuthMock.mockReturnValue({ currentUser });

    await expect(signInAnonymouslyIfNeeded()).resolves.toBe(currentUser);
    expect(signInAnonymouslyMock).not.toHaveBeenCalled();
  });

  it("links anonymous users with google first", async () => {
    const auth = {
      currentUser: { uid: "anon-uid", isAnonymous: true },
    };
    const linkedUser = { uid: "google-uid", isAnonymous: false, email: "user@example.com" };
    getAuthMock.mockReturnValue(auth);
    linkWithPopupMock.mockResolvedValue({ user: linkedUser });

    await expect(signInWithGoogle()).resolves.toEqual({
      user: linkedUser,
      method: "linked",
    });
    expect(linkWithPopupMock).toHaveBeenCalledOnce();
    expect(signInWithPopupMock).not.toHaveBeenCalled();
  });

  it("falls back to popup sign-in when anonymous linking cannot be completed", async () => {
    const auth = {
      currentUser: { uid: "anon-uid", isAnonymous: true },
    };
    const signedInUser = { uid: "google-uid", isAnonymous: false, email: "user@example.com" };
    getAuthMock.mockReturnValue(auth);
    linkWithPopupMock.mockRejectedValue({ code: "auth/credential-already-in-use", message: "credential in use" });
    signInWithPopupMock.mockResolvedValue({ user: signedInUser });

    await expect(signInWithGoogle()).resolves.toEqual({
      user: signedInUser,
      method: "signed_in",
    });
    expect(linkWithPopupMock).toHaveBeenCalledOnce();
    expect(signInWithPopupMock).toHaveBeenCalledOnce();
  });

  it("returns friendly popup errors", async () => {
    getAuthMock.mockReturnValue({
      currentUser: null,
    });
    signInWithPopupMock.mockRejectedValue({
      code: "auth/popup-closed-by-user",
      message: "popup closed",
    });

    await expect(signInWithGoogle()).rejects.toThrow("Googleログインがキャンセルされました。");
    expect(getFirebaseAuthErrorMessage()).toBe("Googleログインがキャンセルされました。");
  });

  it("surfaces auth state subscription failures as short errors", () => {
    onAuthStateChangedMock.mockImplementation((_auth, _next, errorCallback) => {
      errorCallback?.(new Error("subscription failed"));
      return () => undefined;
    });

    const callback = vi.fn();
    subscribeAuthState(callback);

    expect(callback).toHaveBeenCalledWith(null);
    expect(getFirebaseAuthErrorMessage()).toBe("subscription failed");
  });
});
