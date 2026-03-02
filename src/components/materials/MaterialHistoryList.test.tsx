import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialHistoryList } from "@/components/materials/MaterialHistoryList";

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

describe("MaterialHistoryList", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    buildAuthenticatedRequestHeadersMock.mockReset();
    buildAuthenticatedRequestHeadersMock.mockResolvedValue({
      "x-user-id": "u1",
      authorization: "Bearer token-1",
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("deletes a registered video from the list", async () => {
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
                updatedAt: "2026-03-02T00:00:00.000Z",
              },
              {
                materialId: "mat-2",
                youtubeId: "def456",
                youtubeUrl: "https://www.youtube.com/watch?v=def456",
                title: "Video Two",
                channel: "Channel Two",
                status: "ready",
                pipelineVersion: "v1",
                updatedAt: "2026-03-02T01:00:00.000Z",
              },
            ],
          }),
        };
      }

      if (url.endsWith("/api/materials/mat-1") && init?.method === "DELETE") {
        return {
          ok: true,
          status: 204,
          json: async () => null,
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<MaterialHistoryList />);

    await waitFor(() => {
      expect(screen.getByText("Video One")).toBeInTheDocument();
      expect(screen.getByText("Video Two")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/materials/mat-1", {
        method: "DELETE",
        headers: {
          "x-user-id": "u1",
          authorization: "Bearer token-1",
        },
      });
      expect(screen.queryByText("Video One")).not.toBeInTheDocument();
      expect(screen.getByText("Video Two")).toBeInTheDocument();
    });
  });
});
