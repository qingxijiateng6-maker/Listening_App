import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthTopRight } from "@/components/auth/AuthTopRight";

const authMocks = vi.hoisted(() => ({
  getFirebaseAuthErrorMessageMock: vi.fn(),
  signInAnonymouslyIfNeededMock: vi.fn(),
  signInWithGoogleMock: vi.fn(),
  subscribeAuthStateMock: vi.fn(),
}));

vi.mock("@/lib/firebase/auth", () => ({
  getFirebaseAuthErrorMessage: authMocks.getFirebaseAuthErrorMessageMock,
  signInAnonymouslyIfNeeded: authMocks.signInAnonymouslyIfNeededMock,
  signInWithGoogle: authMocks.signInWithGoogleMock,
  subscribeAuthState: authMocks.subscribeAuthStateMock,
}));

describe("AuthTopRight", () => {
  it("keeps the page usable and shows a short error when auth initialization fails", async () => {
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
  });

  it("shows authenticated status when google user is signed in", async () => {
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
    expect(screen.getByText("Googleアカウントでログイン中です: user@example.com")).toBeInTheDocument();
    expect(screen.getByText("Googleログイン済み: user@example.com")).toBeInTheDocument();
  });

  it("shows a linking success message after upgrading an anonymous user", async () => {
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

  it("shows a friendly google login error message", async () => {
    authMocks.getFirebaseAuthErrorMessageMock.mockReturnValue("");
    authMocks.subscribeAuthStateMock.mockImplementation((callback: (user: null) => void) => {
      callback(null);
      return () => undefined;
    });
    authMocks.signInAnonymouslyIfNeededMock.mockResolvedValue(null);
    authMocks.signInWithGoogleMock.mockRejectedValue(new Error("Googleログインがキャンセルされました。"));

    render(<AuthTopRight />);

    fireEvent.click(screen.getByRole("button", { name: "Googleでログイン" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Googleログインがキャンセルされました。");
    });
  });
});
