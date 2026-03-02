import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SavedExpressionsList } from "@/components/materials/SavedExpressionsList";

const fetchMock = vi.fn();
const buildAuthenticatedRequestHeadersMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/firebase/auth", () => ({
  buildAuthenticatedRequestHeaders: () => buildAuthenticatedRequestHeadersMock(),
}));

describe("SavedExpressionsList", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    buildAuthenticatedRequestHeadersMock.mockReset();
    buildAuthenticatedRequestHeadersMock.mockResolvedValue({
      "x-user-id": "u1",
      authorization: "Bearer token-1",
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows saved expressions grouped by video", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/materials") && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          json: async () => ({
            materials: [
              {
                materialId: "mat-1",
                youtubeId: "abc123",
                youtubeUrl: "https://www.youtube.com/watch?v=abc123",
                title: "Video One",
                channel: "Channel One",
                status: "ready",
                pipelineVersion: "v1",
              },
              {
                materialId: "mat-2",
                youtubeId: "def456",
                youtubeUrl: "https://www.youtube.com/watch?v=def456",
                title: "Video Two",
                channel: "Channel Two",
                status: "ready",
                pipelineVersion: "v1",
              },
            ],
          }),
        };
      }

      if (url.endsWith("/api/materials/mat-1/expressions")) {
        return {
          ok: true,
          json: async () => ({
            expressions: [
              {
                expressionId: "exp-1",
                expression: "take ownership",
                meaning: "責任を持つ",
                exampleSentence: "We should take ownership of the result.",
              },
            ],
          }),
        };
      }

      if (url.endsWith("/api/materials/mat-2/expressions")) {
        return {
          ok: true,
          json: async () => ({
            expressions: [],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<SavedExpressionsList />);

    await waitFor(() => {
      expect(screen.getByText("保存した表現")).toBeInTheDocument();
      expect(screen.getByText("Video One")).toBeInTheDocument();
      expect(screen.getByText("take ownership")).toBeInTheDocument();
      expect(screen.queryByText("Video Two")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "この動画を開く" })).toHaveAttribute("href", "/materials/mat-1");
    });
  });
});
