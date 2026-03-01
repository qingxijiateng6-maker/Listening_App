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

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/firebase/auth", () => ({
  buildAuthenticatedRequestHeaders: vi.fn().mockResolvedValue({
    "x-user-id": "u1",
    authorization: "Bearer token-1",
  }),
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

describe("registration -> queued job -> learning integration", () => {
  beforeEach(() => {
    pushMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    materials.clear();
    segments.clear();
  });

  it("registers video through API, then renders learning screen after completion", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
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

    render(<MaterialLearningScreen materialId="mat1" />);

    await waitFor(() => {
      expect(screen.getByText("status: ready")).toBeInTheDocument();
      expect(screen.getByText("字幕")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /\[1\.0s\].*take ownership and move forward.*選択中/ }),
      ).toBeInTheDocument();
    });
  });
});
