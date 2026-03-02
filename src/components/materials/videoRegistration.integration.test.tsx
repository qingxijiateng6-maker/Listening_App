import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoRegistrationForm } from "@/components/materials/VideoRegistrationForm";

const pushMock = vi.fn();

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
  isPubliclyAccessibleYouTubeVideo: vi.fn().mockResolvedValue(true),
}));

describe("Video registration integration", () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it("moves to the loading screen immediately after submit", async () => {
    render(<VideoRegistrationForm />);

    fireEvent.change(screen.getByLabelText("Youtube URL"), {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "動画を登録" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        "/materials/loading?youtubeUrl=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ",
      );
    });
  });
});
