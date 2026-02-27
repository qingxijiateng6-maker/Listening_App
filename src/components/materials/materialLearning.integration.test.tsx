import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MaterialLearningScreen } from "@/components/materials/MaterialLearningScreen";

const getDocMock = vi.fn();
const getDocsMock = vi.fn();

vi.mock("firebase/firestore", () => ({
  getDoc: (...args: unknown[]) => getDocMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  query: (...args: unknown[]) => args,
  setDoc: vi.fn().mockResolvedValue(undefined),
  doc: (...args: unknown[]) => ({ path: args.join("/") }),
  Timestamp: { now: () => ({ toMillis: () => Date.now() }) },
}));

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

vi.mock("@/lib/firebase/firestore", () => ({
  getDb: vi.fn(() => ({})),
  materialDoc: vi.fn(() => ({ path: "materials/mat1" })),
  segmentsCollection: vi.fn(() => ({ path: "materials/mat1/segments" })),
  expressionsCollection: vi.fn(() => ({ path: "materials/mat1/expressions" })),
  userExpressionsCollection: vi.fn(() => ({ path: "users/u1/expressions" })),
}));

describe("Learning screen integration", () => {
  it("shows ready material with subtitles and expressions", async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        youtubeId: "dQw4w9WgXcQ",
        status: "ready",
        pipelineVersion: "v1",
      }),
    });

    getDocsMock.mockImplementation(async (queryInput: unknown) => {
      const queryHead = Array.isArray(queryInput) ? queryInput[0] : queryInput;
      const path = (queryHead as { path?: string } | undefined)?.path ?? "";

      if (path.includes("/segments")) {
        return {
          docs: [
            {
              id: "s1",
              data: () => ({ startMs: 1000, endMs: 2000, text: "take ownership now" }),
            },
          ],
        };
      }

      if (path.includes("/expressions")) {
        return {
          docs: [
            {
              id: "e1",
              data: () => ({
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
              }),
            },
          ],
        };
      }

      return { docs: [] };
    });

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByText("学習画面")).toBeInTheDocument();
      expect(screen.getByText("status: ready")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "take ownership" })).toBeInTheDocument();
      expect(screen.getByText(/責任を持つ/)).toBeInTheDocument();
    });
  });
});
