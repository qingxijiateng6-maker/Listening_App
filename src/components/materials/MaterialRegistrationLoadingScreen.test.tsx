import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialRegistrationLoadingScreen } from "@/components/materials/MaterialRegistrationLoadingScreen";
import { MATERIAL_PREPARE_CONTINUATION_CONFIRMATION_AFTER_MS } from "@/lib/constants";

const replaceMock = vi.fn();
const fetchMock = vi.fn();
const buildAuthenticatedRequestHeadersMock = vi.fn();
const routerMock = {
  replace: replaceMock,
};

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () =>
    new URLSearchParams({
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }),
}));

vi.mock("@/lib/firebase/auth", () => ({
  buildAuthenticatedRequestHeaders: () => buildAuthenticatedRequestHeadersMock(),
}));

describe("MaterialRegistrationLoadingScreen", () => {
  beforeEach(() => {
    vi.useRealTimers();
    replaceMock.mockReset();
    fetchMock.mockReset();
    buildAuthenticatedRequestHeadersMock.mockReset();
    buildAuthenticatedRequestHeadersMock.mockResolvedValue({
      "x-user-id": "u1",
      authorization: "Bearer token-1",
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("polls the material status after registration and routes to the material page when ready", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        materialId: "mat1",
        status: "processing",
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ready",
        pipelineState: {
          currentStep: "format",
          lastCompletedStep: "format",
          status: "ready",
          updatedAt: { seconds: 2, nanoseconds: 0 },
          errorCode: "",
          errorMessage: "",
        },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        segments: [{ segmentId: "seg-1", startMs: 0, endMs: 1000, text: "Hello world" }],
      }),
    });

    render(<MaterialRegistrationLoadingScreen />);

    expect(screen.getByText("読み込み中です...")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/materials",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-user-id": "u1",
            authorization: "Bearer token-1",
          }),
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/materials/mat1/prepare",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-user-id": "u1",
            authorization: "Bearer token-1",
          }),
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/materials/mat1/segments",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "x-user-id": "u1",
            authorization: "Bearer token-1",
          }),
        }),
      );
      expect(replaceMock).toHaveBeenCalledWith("/materials/mat1");
    });
  });

  it("shows a fallback error when the polling response has no JSON body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        materialId: "mat1",
        status: "processing",
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      text: async () => "",
    });

    render(<MaterialRegistrationLoadingScreen />);

    await waitFor(() => {
      expect(screen.getByText("登録エラー")).toBeInTheDocument();
      expect(screen.getByText("字幕の準備状況を確認できませんでした。")).toBeInTheDocument();
    });
  });

  it("shows an error instead of routing when the ready material still has no subtitle segments", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        materialId: "mat1",
        status: "processing",
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ready",
        pipelineState: {
          currentStep: "format",
          lastCompletedStep: "format",
          status: "ready",
          updatedAt: { seconds: 2, nanoseconds: 0 },
          errorCode: "",
          errorMessage: "",
        },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        segments: [],
      }),
    });

    render(<MaterialRegistrationLoadingScreen />);

    await waitFor(() => {
      expect(screen.getByText("登録エラー")).toBeInTheDocument();
      expect(screen.getByText("字幕データが見つかりませんでした。トップから再度登録してください。")).toBeInTheDocument();
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("keeps polling after the long-wait prompt appears", async () => {
    vi.useFakeTimers();
    let prepareCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/materials") {
        return {
          ok: true,
          json: async () => ({
            materialId: "mat1",
            status: "processing",
          }),
        };
      }

      if (url === "/api/materials/mat1/prepare") {
        prepareCount += 1;
        const isReady = prepareCount >= 82;
        return {
          ok: true,
          json: async () => ({
            status: isReady ? "ready" : "processing",
            pipelineState: {
              currentStep: isReady ? "format" : "captions",
              lastCompletedStep: isReady ? "format" : "meta",
              status: isReady ? "ready" : "processing",
              updatedAt: { seconds: isReady ? 3 : 2, nanoseconds: 0 },
              errorCode: "",
              errorMessage: "",
            },
          }),
        };
      }

      if (url === "/api/materials/mat1/segments") {
        return {
          ok: true,
          json: async () => ({
            segments: [{ segmentId: "seg-1", startMs: 0, endMs: 1000, text: "Hello world" }],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await act(async () => {
      render(<MaterialRegistrationLoadingScreen />);
      await Promise.resolve();
    });
    expect(prepareCount).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MATERIAL_PREPARE_CONTINUATION_CONFIRMATION_AFTER_MS);
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    const prepareCountAtPrompt = prepareCount;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(prepareCount).toBeGreaterThan(prepareCountAtPrompt);
    expect(replaceMock).toHaveBeenCalledWith("/materials/mat1");
  }, 10000);
});
