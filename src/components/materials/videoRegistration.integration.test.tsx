import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoRegistrationForm } from "@/components/materials/VideoRegistrationForm";

const pushMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/firebase/auth", () => ({
  signInAnonymouslyIfNeeded: vi.fn().mockResolvedValue({ uid: "u1" }),
}));

vi.mock("@/lib/youtube", () => ({
  parseYouTubeUrl: vi.fn(() => ({
    youtubeId: "dQw4w9WgXcQ",
    normalizedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  })),
  isPubliclyAccessibleYouTubeVideo: vi.fn().mockResolvedValue(true),
}));

describe("Video registration integration", () => {
  beforeEach(() => {
    pushMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("reuses existing material and avoids duplicate material/job creation", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        materialId: "existing-mat-1",
        reused: true,
      }),
    });

    render(<VideoRegistrationForm />);

    fireEvent.change(screen.getByLabelText("YouTube URL"), {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "教材を作成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/materials/existing-mat-1");
    });
  });

  it("creates material via API and routes to learning page", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        materialId: "mat1",
        reused: false,
      }),
    });

    render(<VideoRegistrationForm />);

    fireEvent.change(screen.getByLabelText("YouTube URL"), {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "教材を作成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/materials",
        expect.objectContaining({
          method: "POST",
        }),
      );
      expect(pushMock).toHaveBeenCalledWith("/materials/mat1");
    });
  });
});
