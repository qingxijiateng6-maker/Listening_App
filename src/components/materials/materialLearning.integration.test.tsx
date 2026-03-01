import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialLearningScreen } from "@/components/materials/MaterialLearningScreen";

const fetchMock = vi.fn();

vi.mock("@/components/materials/YouTubeIFramePlayer", () => ({
  YouTubeIFramePlayer: () => <div data-testid="youtube-player">player</div>,
}));

describe("Learning screen integration", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows ready material with video and subtitles", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/materials/mat1")) {
        return {
          ok: true,
          json: async () => ({
            material: {
              materialId: "mat1",
              youtubeId: "dQw4w9WgXcQ",
              status: "ready",
              pipelineVersion: "v1",
            },
            status: "ready",
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/segments")) {
        return {
          ok: true,
          json: async () => ({
            segments: [{ segmentId: "s1", startMs: 1000, endMs: 2000, text: "take ownership now" }],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByText("学習画面")).toBeInTheDocument();
      expect(screen.getByText("status: ready")).toBeInTheDocument();
      expect(screen.getByText("動画")).toBeInTheDocument();
      expect(screen.getByText("字幕")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /\[1\.0s\].*take ownership now.*選択中/ })).toBeInTheDocument();
    });
  });

  it("shows empty states when subtitles are unavailable", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/materials/mat1")) {
        return {
          ok: true,
          json: async () => ({
            material: {
              materialId: "mat1",
              youtubeId: "dQw4w9WgXcQ",
              status: "processing",
              pipelineVersion: "v1",
            },
            status: "processing",
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/segments")) {
        return {
          ok: true,
          json: async () => ({
            segments: [],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByText("字幕がまだありません")).toBeInTheDocument();
      expect(screen.getByText("字幕を選択してください")).toBeInTheDocument();
    });
  });

  it("keeps subtitle selection in sync with the playback controls", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/materials/mat1")) {
        return {
          ok: true,
          json: async () => ({
            material: {
              materialId: "mat1",
              youtubeId: "dQw4w9WgXcQ",
              status: "ready",
              pipelineVersion: "v1",
            },
            status: "ready",
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/segments")) {
        return {
          ok: true,
          json: async () => ({
            segments: [
              { segmentId: "s1", startMs: 1000, endMs: 2000, text: "first subtitle" },
              { segmentId: "s2", startMs: 3000, endMs: 4000, text: "second subtitle" },
            ],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /\[3\.0s\].*second subtitle.*ジャンプ/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /\[3\.0s\].*second subtitle.*ジャンプ/ }));

    await waitFor(() => {
      expect(screen.getByText("選択中の字幕")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /\[3\.0s\].*second subtitle.*選択中/ })).toBeInTheDocument();
    });
  });
});
