import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialRegistrationLoadingScreen } from "@/components/materials/MaterialRegistrationLoadingScreen";

const replaceMock = vi.fn();
const fetchMock = vi.fn();
const buildAuthenticatedRequestHeadersMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
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
        material: {
          materialId: "mat1",
          youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          youtubeId: "dQw4w9WgXcQ",
          title: "Sample",
          channel: "Channel",
          durationSec: 120,
          status: "ready",
          pipelineVersion: "v2",
          createdAt: { seconds: 1, nanoseconds: 0 },
          updatedAt: { seconds: 2, nanoseconds: 0 },
        },
        status: "ready",
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
        "/api/materials/mat1",
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
});
