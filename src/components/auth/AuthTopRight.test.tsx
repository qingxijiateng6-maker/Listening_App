import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthTopRight } from "@/components/auth/AuthTopRight";

const subscribeAuthStateMock = vi.fn();
const signInAnonymouslyIfNeededMock = vi.fn();
const signInWithGoogleMock = vi.fn();
const getFirebaseAuthErrorMessageMock = vi.fn();

vi.mock("@/lib/firebase/auth", () => ({
  getFirebaseAuthErrorMessage: getFirebaseAuthErrorMessageMock,
  signInAnonymouslyIfNeeded: signInAnonymouslyIfNeededMock,
  signInWithGoogle: signInWithGoogleMock,
  subscribeAuthState: subscribeAuthStateMock,
}));

describe("AuthTopRight", () => {
  it("keeps the page usable and shows a short error when auth initialization fails", async () => {
    getFirebaseAuthErrorMessageMock.mockReturnValue("Firebase設定が不足しています。");
    subscribeAuthStateMock.mockImplementation((callback: (user: null) => void) => {
      callback(null);
      return () => undefined;
    });
    signInAnonymouslyIfNeededMock.mockResolvedValue(null);

    render(<AuthTopRight />);

    expect(screen.getByRole("button", { name: "Googleでログイン" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Firebase設定が不足しています。")).toBeInTheDocument();
    });
  });
});
