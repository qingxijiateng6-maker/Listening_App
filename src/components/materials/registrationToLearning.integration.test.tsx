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
  materialDoc: vi.fn((materialId: string) => ({ path: `materials/${materialId}` })),
  segmentsCollection: vi.fn((materialId: string) => ({ path: `materials/${materialId}/segments` })),
  expressionsCollection: vi.fn((materialId: string) => ({ path: `materials/${materialId}/expressions` })),
  userExpressionsCollection: vi.fn((uid: string) => ({ path: `users/${uid}/expressions` })),
}));

vi.mock("firebase/firestore", () => ({
  Timestamp: { now: () => ({ toMillis: () => Date.now() }) },
  where: (...args: unknown[]) => args,
  limit: (value: number) => value,
  query: (head: unknown) => head,
  doc: (...args: unknown[]) => {
    const [head, tail] = args;
    if (head && typeof head === "object" && "path" in (head as Record<string, unknown>)) {
      return { path: `${String((head as { path: string }).path)}/${String(tail)}` };
    }
    return { path: args.map(String).join("/") };
  },
  getDoc: async (ref: { path: string }) => {
    if (ref.path.startsWith("materials/")) {
      const id = ref.path.replace("materials/", "");
      const data = materials.get(id);
      return { exists: () => Boolean(data), data: () => data };
    }
    return { exists: () => false, data: () => undefined };
  },
  getDocs: async (queryHead: { path?: string }) => {
    const path = queryHead?.path ?? "";
    if (path === "materials") {
      const docs = [...materials.entries()].map(([id, data]) => ({ id, data: () => data }));
      return { empty: docs.length === 0, docs };
    }
    if (path.endsWith("/segments")) {
      const materialId = path.split("/")[1] ?? "";
      const docs = segments.get(materialId) ?? [];
      return { docs: docs.map((row) => ({ id: row.id, data: () => row.data })) };
    }
    if (path.endsWith("/expressions")) {
      const materialId = path.split("/")[1] ?? "";
      const docs = expressions.get(materialId) ?? [];
      return { docs: docs.map((row) => ({ id: row.id, data: () => row.data })) };
    }
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
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        materialId: "mat1",
        status: "ready",
        reused: false,
      }),
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
      expect(screen.getByText("意味: 責任を持つ")).toBeInTheDocument();
    });
  });
});
