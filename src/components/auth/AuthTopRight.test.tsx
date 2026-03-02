import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthTopRight } from "@/components/auth/AuthTopRight";

const authMocks = vi.hoisted(() => ({
  completeGoogleRedirectSignInMock: vi.fn(),
  ensureAnonymousSessionMock: vi.fn(),
  getFirebaseAuthErrorCodeMock: vi.fn(),
  getFirebaseAuthErrorMessageMock: vi.fn(),
  signInAnonymouslyIfNeededMock: vi.fn(),
  signOutToAnonymousMock: vi.fn(),
  signInWithGoogleMock: vi.fn(),
  subscribeAuthStateMock: vi.fn(),
}));

vi.mock("@/lib/firebase/auth", () => ({
  completeGoogleRedirectSignIn: authMocks.completeGoogleRedirectSignInMock,
  ensureAnonymousSession: authMocks.ensureAnonymousSessionMock,
  getFirebaseAuthErrorCode: authMocks.getFirebaseAuthErrorCodeMock,
  getFirebaseAuthErrorMessage: authMocks.getFirebaseAuthErrorMessageMock,
  signInAnonymouslyIfNeeded: authMocks.signInAnonymouslyIfNeededMock,
  signOutToAnonymous: authMocks.signOutToAnonymousMock,
  signInWithGoogle: authMocks.signInWithGoogleMock,
  subscribeAuthState: authMocks.subscribeAuthStateMock,
}));

describe("AuthTopRight", () => {
  it("keeps the page usable and shows a short error when auth initialization fails", async () => {
    authMocks.completeGoogleRedirectSignInMock.mockResolvedValue(null);
    authMocks.ensureAnonymousSessionMock.mockResolvedValue(null);
    authMocks.getFirebaseAuthErrorCodeMock.mockReturnValue("unknown");
    authMocks.getFirebaseAuthErrorMessageMock.mockReturnValue("Firebase設定が不足しています。");
    authMocks.subscribeAuthStateMock.mockImplementation((callback: (user: null) => void) => {
      callback(null);
      return () => undefined;
    });
    authMocks.signInAnonymouslyIfNeededMock.mockResolvedValue(null);

    render(<AuthTopRight />);

    expect(screen.getByRole("button", { name: "Googleでログイン" })).toBeInTheDocument();
    expect(screen.getByText("状態: 匿名ゲスト")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Firebase設定が不足しています。");
    });
    expect(screen.getByText("debug code: unknown")).toBeInTheDocument();
  });

  it("shows authenticated status when google user is signed in", async () => {
    authMocks.completeGoogleRedirectSignInMock.mockResolvedValue(null);
    authMocks.ensureAnonymousSessionMock.mockResolvedValue(null);
    authMocks.getFirebaseAuthErrorCodeMock.mockReturnValue("unknown");
    authMocks.getFirebaseAuthErrorMessageMock.mockReturnValue("");
    authMocks.subscribeAuthStateMock.mockImplementation(
      (callback: (user: { uid: string; isAnonymous: boolean; email: string }) => void) => {
        callback({
          uid: "google-uid",
          isAnonymous: false,
          email: "user@example.com",
        });
        return () => undefined;
      },
    );
    authMocks.signInAnonymouslyIfNeededMock.mockResolvedValue(null);

    render(<AuthTopRight />);

    await waitFor(() => {
      expect(screen.getByText("状態: Googleログイン済み")).toBeInTheDocument();
    });
    expect(screen.getByText("Googleログイン済み: user@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
    expect(screen.queryByText(/Googleアカウントでログイン/)).not.toBeInTheDocument();
    expect(screen.queryByText(/uid:/)).not.toBeInTheDocument();
  });

  it("shows a linking success message after upgrading an anonymous user", async () => {
    authMocks.completeGoogleRedirectSignInMock.mockResolvedValue(null);
    authMocks.ensureAnonymousSessionMock.mockResolvedValue(null);
    authMocks.getFirebaseAuthErrorCodeMock.mockReturnValue("unknown");
    authMocks.getFirebaseAuthErrorMessageMock.mockReturnValue("");
    authMocks.subscribeAuthStateMock.mockImplementation(
      (callback: (user: { uid: string; isAnonymous: boolean; email: string }) => void) => {
        callback({
          uid: "anon-uid",
          isAnonymous: true,
          email: "",
        });
        return () => undefined;
      },
    );
    authMocks.signInAnonymouslyIfNeededMock.mockResolvedValue(null);
    authMocks.signInWithGoogleMock.mockResolvedValue({
      user: { uid: "google-uid", isAnonymous: false, email: "user@example.com" },
      method: "linked",
    });

    render(<AuthTopRight />);

    fireEvent.click(screen.getByRole("button", { name: "Googleでログイン" }));

    await waitFor(() => {
      expect(screen.getByText("匿名ユーザーをGoogleアカウントに連携しました。")).toBeInTheDocument();
    });
  });

  it("shows a login failure message and returns to anonymous mode", async () => {
    authMocks.completeGoogleRedirectSignInMock.mockResolvedValue(null);
    authMocks.getFirebaseAuthErrorCodeMock.mockReturnValue("auth/popup-closed-by-user");
    authMocks.getFirebaseAuthErrorMessageMock.mockReturnValue("");
    authMocks.subscribeAuthStateMock.mockImplementation((callback: (user: null) => void) => {
      callback(null);
      return () => undefined;
    });
    authMocks.signInAnonymouslyIfNeededMock.mockResolvedValue(null);
    authMocks.ensureAnonymousSessionMock.mockResolvedValue({
      uid: "anon-uid",
      isAnonymous: true,
      email: "",
    });
    authMocks.signInWithGoogleMock.mockRejectedValue(new Error("Googleログインがキャンセルされました。"));

    render(<AuthTopRight />);

    fireEvent.click(screen.getByRole("button", { name: "Googleでログイン" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("ログインに失敗しました。");
    });
    expect(screen.getByText("状態: 匿名ゲスト")).toBeInTheDocument();
    expect(screen.getByText("匿名ゲストとして利用中です。")).toBeInTheDocument();
    expect(screen.getByText("debug code: auth/popup-closed-by-user")).toBeInTheDocument();
  });

  it("shows a redirect status message when popup login falls back to redirect", async () => {
    authMocks.completeGoogleRedirectSignInMock.mockResolvedValue(null);
    authMocks.ensureAnonymousSessionMock.mockResolvedValue(null);
    authMocks.getFirebaseAuthErrorCodeMock.mockReturnValue("unknown");
    authMocks.getFirebaseAuthErrorMessageMock.mockReturnValue("");
    authMocks.subscribeAuthStateMock.mockImplementation((callback: (user: null) => void) => {
      callback(null);
      return () => undefined;
    });
    authMocks.signInAnonymouslyIfNeededMock.mockResolvedValue(null);
    authMocks.signInWithGoogleMock.mockResolvedValue({
      user: null,
      method: "redirect",
    });

    render(<AuthTopRight />);

    fireEvent.click(screen.getByRole("button", { name: "Googleでログイン" }));

    await waitFor(() => {
      expect(screen.getByText("Googleログイン画面へ移動しています。")).toBeInTheDocument();
    });
  });

  it("shows a success message after returning from redirect login", async () => {
    authMocks.completeGoogleRedirectSignInMock.mockResolvedValue({
      user: { uid: "google-uid", isAnonymous: false, email: "user@example.com" },
      method: "linked",
    });
    authMocks.getFirebaseAuthErrorCodeMock.mockReturnValue("unknown");
    authMocks.getFirebaseAuthErrorMessageMock.mockReturnValue("");
    authMocks.ensureAnonymousSessionMock.mockResolvedValue(null);
    authMocks.subscribeAuthStateMock.mockImplementation(
      (callback: (user: { uid: string; isAnonymous: boolean; email: string }) => void) => {
        callback({
          uid: "google-uid",
          isAnonymous: false,
          email: "user@example.com",
        });
        return () => undefined;
      },
    );
    authMocks.signInAnonymouslyIfNeededMock.mockResolvedValue(null);

    render(<AuthTopRight />);

    await waitFor(() => {
      expect(screen.getByText("匿名ユーザーをGoogleアカウントに連携しました。")).toBeInTheDocument();
    });
  });

  it("shows a login failure message after redirect completion fails and returns to anonymous mode", async () => {
    authMocks.completeGoogleRedirectSignInMock.mockRejectedValue(new Error("redirect failed"));
    authMocks.getFirebaseAuthErrorCodeMock.mockReturnValue("auth/network-request-failed");
    authMocks.getFirebaseAuthErrorMessageMock.mockReturnValue("");
    authMocks.subscribeAuthStateMock.mockImplementation((callback: (user: null) => void) => {
      callback(null);
      return () => undefined;
    });
    authMocks.signInAnonymouslyIfNeededMock.mockResolvedValue(null);
    authMocks.ensureAnonymousSessionMock.mockResolvedValue({
      uid: "anon-uid",
      isAnonymous: true,
      email: "",
    });

    render(<AuthTopRight />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("ログインに失敗しました。");
    });
    expect(screen.getByText("状態: 匿名ゲスト")).toBeInTheDocument();
    expect(screen.getByText("匿名ゲストとして利用中です。")).toBeInTheDocument();
    expect(screen.getByText("debug code: auth/network-request-failed")).toBeInTheDocument();
  });

  it("signs out a google user back to an anonymous session", async () => {
    authMocks.completeGoogleRedirectSignInMock.mockResolvedValue(null);
    authMocks.ensureAnonymousSessionMock.mockResolvedValue(null);
    authMocks.getFirebaseAuthErrorCodeMock.mockReturnValue("unknown");
    authMocks.getFirebaseAuthErrorMessageMock.mockReturnValue("");
    authMocks.subscribeAuthStateMock.mockImplementation(
      (callback: (user: { uid: string; isAnonymous: boolean; email: string }) => void) => {
        callback({
          uid: "google-uid",
          isAnonymous: false,
          email: "user@example.com",
        });
        return () => undefined;
      },
    );
    authMocks.signInAnonymouslyIfNeededMock.mockResolvedValue(null);
    authMocks.signOutToAnonymousMock.mockResolvedValue({
      uid: "anon-uid",
      isAnonymous: true,
      email: "",
    });

    render(<AuthTopRight />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "ログアウト" }));

    await waitFor(() => {
      expect(screen.getByText("Googleアカウントからログアウトしました。")).toBeInTheDocument();
    });
    expect(screen.getByText("状態: 匿名ゲスト")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Googleでログイン" })).toBeInTheDocument();
  });
});
