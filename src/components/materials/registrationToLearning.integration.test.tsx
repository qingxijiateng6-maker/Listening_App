import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialLearningScreen } from "@/components/materials/MaterialLearningScreen";
import { VideoRegistrationForm } from "@/components/materials/VideoRegistrationForm";

type DocRecord = Record<string, unknown>;

const pushMock = vi.fn();
const fetchMock = vi.fn();

const materials = new Map<string, DocRecord>();
const segments = new Map<string, Array<{ id: string; data: DocRecord }>>();
const expressions = new Map<string, Array<{ id: string; data: DocRecord }>>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/firebase/auth", () => ({
  signInAnonymouslyIfNeeded: vi.fn().mockResolvedValue({ uid: "u1" }),
  subscribeAuthState: (callback: (user: { uid: string }) => void) => {
    callback({ uid: "u1" });
    return () => undefined;
  },
}));

vi.mock("@/lib/youtube", () => ({
  parseYouTubeUrl: vi.fn(() => ({
    youtubeId: "dQw4w9WgXcQ",
    normalizedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  })),
}));

vi.mock("@/components/materials/YouTubeIFramePlayer", () => ({
  YouTubeIFramePlayer: () => <div data-testid="youtube-player">player</div>,
}));

vi.mock("@/lib/firebase/firestore", () => ({
  getDb: vi.fn(() => ({})),
  userExpressionsCollection: vi.fn((uid: string) => ({ path: `users/${uid}/expressions` })),
}));

vi.mock("firebase/firestore", () => ({
  Timestamp: { now: () => ({ toMillis: () => Date.now() }) },
  doc: (...args: unknown[]) => {
    const [head, tail] = args;
    if (head && typeof head === "object" && "path" in (head as Record<string, unknown>)) {
      return { path: `${String((head as { path: string }).path)}/${String(tail)}` };
    }
    return { path: args.map(String).join("/") };
  },
  getDocs: async (queryHead: { path?: string }) => {
    const path = queryHead?.path ?? "";
    if (path.startsWith("users/")) {
      return { docs: [] };
    }
    return { empty: true, docs: [] };
  },
}));

describe("registration -> queued job -> learning integration", () => {
  beforeEach(() => {
    pushMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    materials.clear();
    segments.clear();
    expressions.clear();
  });

  it("registers video through API, then renders learning screen after completion", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/materials")) {
        return {
          ok: true,
          json: async () => ({
            materialId: "mat1",
            status: "ready",
            reused: false,
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1")) {
        return {
          ok: true,
          json: async () => ({
            material: {
              materialId: "mat1",
              ...(materials.get("mat1") ?? {}),
            },
            status: materials.get("mat1")?.status ?? "queued",
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/segments")) {
        return {
          ok: true,
          json: async () => ({
            segments: (segments.get("mat1") ?? []).map((row) => ({
              segmentId: row.id,
              ...row.data,
            })),
          }),
        };
      }

      if (url.endsWith("/api/materials/mat1/expressions")) {
        return {
          ok: true,
          json: async () => ({
            expressions: (expressions.get("mat1") ?? []).map((row) => ({
              expressionId: row.id,
              ...row.data,
            })),
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

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<VideoRegistrationForm />);

    fireEvent.change(screen.getByLabelText("YouTube URL"), {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "教材を作成" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/materials/mat1");
    });

    materials.set("mat1", {
      youtubeId: "dQw4w9WgXcQ",
      status: "ready",
      pipelineVersion: "v1",
    });
    segments.set("mat1", [
      {
        id: "seg1",
        data: { startMs: 1000, endMs: 3000, text: "take ownership and move forward" },
      },
    ]);
    expressions.set("mat1", [
      {
        id: "exp1",
        data: {
          expressionText: "take ownership",
          scoreFinal: 82,
          axisScores: {
            utility: 85,
            portability: 78,
            naturalness: 74,
            c1_value: 77,
            context_robustness: 70,
          },
          meaningJa: "責任を持つ",
          reasonShort: "5軸評価=82, 出現=1",
          scenarioExample: "I need to take ownership of this task.",
          flagsFinal: [],
          occurrences: [{ startMs: 1000, endMs: 3000, segmentId: "seg1" }],
          createdAt: {},
        },
      },
    ]);

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByText("status: ready")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "take ownership" })).toBeInTheDocument();
      expect(screen.getByText("責任を持つ")).toBeInTheDocument();
    });
  });
});
