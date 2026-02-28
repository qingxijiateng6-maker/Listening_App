import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
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

    await waitFor(() => {
      expect(screen.getByText("Firebase設定が不足しています。")).toBeInTheDocument();
    });
  });
});
