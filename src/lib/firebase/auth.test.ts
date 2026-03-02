import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAuthMock = vi.fn();
const getRedirectResultMock = vi.fn();
const linkWithRedirectMock = vi.fn();
const signInWithRedirectMock = vi.fn();
const signInWithPopupMock = vi.fn();
const signInAnonymouslyMock = vi.fn();
const signOutMock = vi.fn();
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
  getRedirectResult: (...args: Parameters<typeof getRedirectResultMock>) => getRedirectResultMock(...args),
  linkWithRedirect: (...args: Parameters<typeof linkWithRedirectMock>) => linkWithRedirectMock(...args),
  onAuthStateChanged: (...args: Parameters<typeof onAuthStateChangedMock>) => onAuthStateChangedMock(...args),
  signInWithRedirect: (...args: Parameters<typeof signInWithRedirectMock>) => signInWithRedirectMock(...args),
  signInWithPopup: (...args: Parameters<typeof signInWithPopupMock>) => signInWithPopupMock(...args),
  signInAnonymously: (...args: Parameters<typeof signInAnonymouslyMock>) => signInAnonymouslyMock(...args),
  signOut: (...args: Parameters<typeof signOutMock>) => signOutMock(...args),
}));

vi.mock("@/lib/firebase/client", () => ({
  tryGetFirebaseApp: () => tryGetFirebaseAppMock(),
  getFirebaseClientError: () => getFirebaseClientErrorMock(),
}));

import {
  buildAuthenticatedRequestHeaders,
  completeGoogleRedirectSignIn,
  ensureAnonymousSession,
  getFirebaseAuthErrorCode,
  getFirebaseAuthErrorMessage,
  signInAnonymouslyIfNeeded,
  signOutToAnonymous,
  signInWithGoogle,
  subscribeAuthState,
} from "@/lib/firebase/auth";

describe("firebase auth helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getAuthMock.mockReset();
    getRedirectResultMock.mockReset();
    linkWithRedirectMock.mockReset();
    signInWithRedirectMock.mockReset();
    signInWithPopupMock.mockReset();
    signInAnonymouslyMock.mockReset();
    signOutMock.mockReset();
    onAuthStateChangedMock.mockReset();
    googleAuthProviderSetCustomParametersMock.mockReset();
    tryGetFirebaseAppMock.mockReset();
    getFirebaseClientErrorMock.mockReset();
    tryGetFirebaseAppMock.mockReturnValue({ name: "app" });
    getAuthMock.mockReturnValue({ currentUser: null });
    getRedirectResultMock.mockResolvedValue(null);
    getFirebaseClientErrorMock.mockReturnValue(null);
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("signs in anonymously only when no current user exists", async () => {
    const currentUser = { uid: "anon-uid", isAnonymous: true };
    getAuthMock.mockReturnValue({ currentUser });

    await expect(signInAnonymouslyIfNeeded()).resolves.toBe(currentUser);
    expect(signInAnonymouslyMock).not.toHaveBeenCalled();
  });

  it("builds request headers from the current firebase user", async () => {
    const currentUser = {
      uid: "anon-uid",
      isAnonymous: true,
      getIdToken: vi.fn().mockResolvedValue("token-123"),
    };
    getAuthMock.mockReturnValue({ currentUser });

    await expect(buildAuthenticatedRequestHeaders()).resolves.toEqual({
      "x-user-id": "anon-uid",
      authorization: "Bearer token-123",
    });
  });

  it("signs out and restores an anonymous user", async () => {
    const auth: { currentUser: { uid: string; isAnonymous: boolean } | null } = {
      currentUser: { uid: "google-uid", isAnonymous: false },
    };
    const anonymousUser = { uid: "anon-uid", isAnonymous: true };
    getAuthMock.mockReturnValue(auth);
    signOutMock.mockImplementation(async () => {
      auth.currentUser = null;
    });
    signInAnonymouslyMock.mockResolvedValue({ user: anonymousUser });

    await expect(signOutToAnonymous()).resolves.toBe(anonymousUser);
    expect(signOutMock).toHaveBeenCalledWith(auth);
    expect(signInAnonymouslyMock).toHaveBeenCalledWith(auth);
  });

  it("restores an existing anonymous session without signing out", async () => {
    const anonymousUser = { uid: "anon-uid", isAnonymous: true };
    getAuthMock.mockReturnValue({ currentUser: anonymousUser });

    await expect(ensureAnonymousSession()).resolves.toBe(anonymousUser);
    expect(signOutMock).not.toHaveBeenCalled();
    expect(signInAnonymouslyMock).not.toHaveBeenCalled();
  });

  it("restores an anonymous session when no current user exists", async () => {
    const anonymousUser = { uid: "anon-uid", isAnonymous: true };
    getAuthMock.mockReturnValue({ currentUser: null });
    signInAnonymouslyMock.mockResolvedValue({ user: anonymousUser });

    await expect(ensureAnonymousSession()).resolves.toBe(anonymousUser);
    expect(signOutMock).not.toHaveBeenCalled();
    expect(signInAnonymouslyMock).toHaveBeenCalled();
  });

  it("signs out anonymous users before starting popup sign-in", async () => {
    const auth = {
      currentUser: { uid: "anon-uid", isAnonymous: true },
    };
    const googleUser = { uid: "google-uid", isAnonymous: false, email: "user@example.com" };
    getAuthMock.mockReturnValue(auth);
    signOutMock.mockImplementation(async () => {
      auth.currentUser = null;
    });
    signInWithPopupMock.mockResolvedValue({ user: googleUser });

    await expect(signInWithGoogle()).resolves.toEqual({
      user: googleUser,
      method: "signed_in",
    });
    expect(signOutMock).toHaveBeenCalledWith(auth);
    expect(signInWithPopupMock).toHaveBeenCalledOnce();
    expect(linkWithRedirectMock).not.toHaveBeenCalled();
  });

  it("starts popup sign-in for signed-out users", async () => {
    const auth = {
      currentUser: null,
    };
    const googleUser = { uid: "google-uid", isAnonymous: false, email: "user@example.com" };
    getAuthMock.mockReturnValue(auth);
    signInWithPopupMock.mockResolvedValue({ user: googleUser });

    await expect(signInWithGoogle()).resolves.toEqual({
      user: googleUser,
      method: "signed_in",
    });
    expect(signInWithPopupMock).toHaveBeenCalledOnce();
    expect(linkWithRedirectMock).not.toHaveBeenCalled();
  });

  it("returns friendly popup sign-in errors", async () => {
    const auth = {
      currentUser: null,
    };
    getAuthMock.mockReturnValue(auth);
    signInWithPopupMock.mockRejectedValue({
      code: "auth/network-request-failed",
      message: "network failed",
    });

    await expect(signInWithGoogle()).rejects.toThrow("ネットワークエラーのためGoogleログインに失敗しました。");
    expect(getFirebaseAuthErrorMessage()).toBe("ネットワークエラーのためGoogleログインに失敗しました。");
    expect(getFirebaseAuthErrorCode()).toBe("auth/network-request-failed");
    expect(signInWithPopupMock).toHaveBeenCalledOnce();
  });

  it("falls back to redirect when popup sign-in is blocked", async () => {
    const auth = {
      currentUser: null,
    };
    getAuthMock.mockReturnValue(auth);
    signInWithPopupMock.mockRejectedValue({
      code: "auth/popup-blocked",
      message: "popup blocked",
    });

    await expect(signInWithGoogle()).resolves.toEqual({
      user: null,
      method: "redirect",
    });
    expect(signInWithRedirectMock).toHaveBeenCalledOnce();
  });

  it("completes a pending redirect sign-in", async () => {
    const getItemMock = vi.fn().mockReturnValue("linked");
    const removeItemMock = vi.fn();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: getItemMock,
        setItem: vi.fn(),
        removeItem: removeItemMock,
      },
    });
    const redirectedUser = { uid: "google-uid", isAnonymous: false, email: "user@example.com" };
    getRedirectResultMock.mockResolvedValue({
      user: redirectedUser,
    });

    await expect(completeGoogleRedirectSignIn()).resolves.toEqual({
      user: redirectedUser,
      method: "linked",
    });
    expect(removeItemMock).toHaveBeenCalledOnce();
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
    expect(getFirebaseAuthErrorCode()).toBe("unknown");
  });
});
