import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialLearningScreen } from "@/components/materials/MaterialLearningScreen";

const fetchMock = vi.fn();

vi.mock("@/lib/firebase/auth", () => ({
  signInAnonymouslyIfNeeded: vi.fn().mockResolvedValue({ uid: "u1" }),
  subscribeAuthState: (callback: (user: { uid: string }) => void) => {
    callback({ uid: "u1" });
    return () => undefined;
  },
}));

vi.mock("@/components/materials/YouTubeIFramePlayer", () => ({
  YouTubeIFramePlayer: () => <div data-testid="youtube-player">player</div>,
}));

describe("Learning screen integration", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows ready material with subtitles and expressions", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
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

      if (url.endsWith("/api/materials/mat1/expressions")) {
        return {
          ok: true,
          json: async () => ({
            expressions: [
              {
                expressionId: "e1",
                expressionText: "take ownership",
                scoreFinal: 80,
                axisScores: {
                  utility: 80,
                  portability: 78,
                  naturalness: 75,
                  c1_value: 76,
                  context_robustness: 70,
                },
                meaningJa: "責任を持つ",
                reasonShort: "高頻度かつ実用的",
                scenarioExample: "I need to take ownership of this task.",
                flagsFinal: [],
                occurrences: [{ startMs: 1000, endMs: 2000, segmentId: "s1" }],
                createdAt: {},
              },
            ],
          }),
        };
      }

      if (url.endsWith("/api/users/me/expressions")) {
        expect(init?.headers).toMatchObject({ "x-user-id": "u1" });
        return {
          ok: true,
          json: async () => ({
            expressions: [
              {
                expressionId: "e1",
                status: "saved",
                updatedAt: "2026-02-28T00:00:00.000Z",
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByText("学習画面")).toBeInTheDocument();
      expect(screen.getByText("status: ready")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "take ownership" })).toBeInTheDocument();
      expect(screen.getByText(/責任を持つ/)).toBeInTheDocument();
      expect(screen.getByText("status: saved")).toBeInTheDocument();
    });
  });

  it("shows the normalized glossary surface text returned by the API", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
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
            segments: [{ segmentId: "s1", startMs: 1000, endMs: 2000, text: "Don't stop now" }],
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/expressions")) {
        return {
          ok: true,
          json: async () => ({
            expressions: [],
          }),
        };
      }

      if (url.endsWith("/api/users/me/expressions")) {
        return {
          ok: true,
          json: async () => ({
            expressions: [],
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/glossary")) {
        expect(JSON.parse(String(init?.body))).toEqual({ surfaceText: "don't" });
        return {
          ok: true,
          json: async () => ({
            surfaceText: "don't",
            meaningJa: "do not の短縮形",
            cacheHit: false,
            latencyMs: 12,
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /\[1\.0\] Don't stop now/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /\[1\.0\] Don't stop now/ }));
    fireEvent.click(screen.getByRole("button", { name: "don't" }));

    await waitFor(() => {
      expect(screen.getByText("語句: don't")).toBeInTheDocument();
      expect(screen.getByText("do not の短縮形")).toBeInTheDocument();
    });
  });

  it("updates an expression status through the API", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
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

      if (url.endsWith("/api/materials/mat1/expressions")) {
        return {
          ok: true,
          json: async () => ({
            expressions: [
              {
                expressionId: "e1",
                expressionText: "take ownership",
                scoreFinal: 80,
                axisScores: {
                  utility: 80,
                  portability: 78,
                  naturalness: 75,
                  c1_value: 76,
                  context_robustness: 70,
                },
                meaningJa: "責任を持つ",
                reasonShort: "高頻度かつ実用的",
                scenarioExample: "I need to take ownership of this task.",
                flagsFinal: [],
                occurrences: [{ startMs: 1000, endMs: 2000, segmentId: "s1" }],
                createdAt: {},
              },
            ],
          }),
        };
      }

      if (url.endsWith("/api/users/me/expressions") && init?.method === "GET") {
        return {
          ok: true,
          json: async () => ({
            expressions: [],
          }),
        };
      }

      if (url.endsWith("/api/users/me/expressions/e1") && init?.method === "PUT") {
        expect(init?.headers).toMatchObject({
          "content-type": "application/json",
          "x-user-id": "u1",
        });
        expect(JSON.parse(String(init?.body))).toEqual({ status: "mastered" });
        return {
          ok: true,
          json: async () => ({
            expressionId: "e1",
            status: "mastered",
            updatedAt: "2026-02-28T00:00:00.000Z",
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "take ownership" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "習得" }));

    await waitFor(() => {
      expect(screen.getByText("status: mastered")).toBeInTheDocument();
    });
  });

  it("shows an error when an expression status update fails", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
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

      if (url.endsWith("/api/materials/mat1/expressions")) {
        return {
          ok: true,
          json: async () => ({
            expressions: [
              {
                expressionId: "e1",
                expressionText: "take ownership",
                scoreFinal: 80,
                axisScores: {
                  utility: 80,
                  portability: 78,
                  naturalness: 75,
                  c1_value: 76,
                  context_robustness: 70,
                },
                meaningJa: "責任を持つ",
                reasonShort: "高頻度かつ実用的",
                scenarioExample: "I need to take ownership of this task.",
                flagsFinal: [],
                occurrences: [{ startMs: 1000, endMs: 2000, segmentId: "s1" }],
                createdAt: {},
              },
            ],
          }),
        };
      }

      if (url.endsWith("/api/users/me/expressions") && init?.method === "GET") {
        return {
          ok: true,
          json: async () => ({
            expressions: [],
          }),
        };
      }

      if (url.endsWith("/api/users/me/expressions/e1") && init?.method === "PUT") {
        return {
          ok: false,
          json: async () => ({
            error: "update failed",
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "take ownership" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("update failed");
    });
    expect(screen.getByText("status: unset")).toBeInTheDocument();
  });
});
