import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAuthMock = vi.fn();
const getRedirectResultMock = vi.fn();
const linkWithPopupMock = vi.fn();
const linkWithRedirectMock = vi.fn();
const signInWithPopupMock = vi.fn();
const signInWithRedirectMock = vi.fn();
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
  getRedirectResult: (...args: Parameters<typeof getRedirectResultMock>) => getRedirectResultMock(...args),
  linkWithPopup: (...args: Parameters<typeof linkWithPopupMock>) => linkWithPopupMock(...args),
  linkWithRedirect: (...args: Parameters<typeof linkWithRedirectMock>) => linkWithRedirectMock(...args),
  onAuthStateChanged: (...args: Parameters<typeof onAuthStateChangedMock>) => onAuthStateChangedMock(...args),
  signInWithRedirect: (...args: Parameters<typeof signInWithRedirectMock>) => signInWithRedirectMock(...args),
  signInWithPopup: (...args: Parameters<typeof signInWithPopupMock>) => signInWithPopupMock(...args),
  signInAnonymously: (...args: Parameters<typeof signInAnonymouslyMock>) => signInAnonymouslyMock(...args),
}));

vi.mock("@/lib/firebase/client", () => ({
  tryGetFirebaseApp: () => tryGetFirebaseAppMock(),
  getFirebaseClientError: () => getFirebaseClientErrorMock(),
}));

import {
  buildAuthenticatedRequestHeaders,
  completeGoogleRedirectSignIn,
  getFirebaseAuthErrorCode,
  getFirebaseAuthErrorMessage,
  signInAnonymouslyIfNeeded,
  signInWithGoogle,
  subscribeAuthState,
} from "@/lib/firebase/auth";

describe("firebase auth helpers", () => {
  beforeEach(() => {
    getAuthMock.mockReset();
    getRedirectResultMock.mockReset();
    linkWithPopupMock.mockReset();
    linkWithRedirectMock.mockReset();
    signInWithPopupMock.mockReset();
    signInWithRedirectMock.mockReset();
    signInAnonymouslyMock.mockReset();
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
    expect(getFirebaseAuthErrorCode()).toBe("auth/popup-closed-by-user");
  });

  it("falls back to redirect when popup sign-in is blocked", async () => {
    getAuthMock.mockReturnValue({
      currentUser: null,
    });
    signInWithPopupMock.mockRejectedValue({
      code: "auth/popup-blocked",
      message: "popup blocked",
    });

    await expect(signInWithGoogle()).resolves.toMatchObject({
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
