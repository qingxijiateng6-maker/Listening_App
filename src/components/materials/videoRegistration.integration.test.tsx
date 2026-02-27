import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoRegistrationForm } from "@/components/materials/VideoRegistrationForm";

const pushMock = vi.fn();
const addDocMock = vi.fn();
const getDocsMock = vi.fn();
const getDocMock = vi.fn();
const setDocMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => addDocMock(...args),
  doc: (...args: unknown[]) => ({ path: args.join("/") }),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  query: (...args: unknown[]) => args,
  where: (...args: unknown[]) => args,
  limit: (value: number) => value,
  Timestamp: { now: () => ({ toMillis: () => Date.now() }) },
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

vi.mock("@/lib/firebase/firestore", () => ({
  materialsCollection: vi.fn(() => ({ path: "materials" })),
  jobsCollection: vi.fn(() => ({ path: "jobs" })),
}));

describe("Video registration integration", () => {
  beforeEach(() => {
    pushMock.mockReset();
    addDocMock.mockReset();
    getDocsMock.mockReset();
    getDocMock.mockReset();
    setDocMock.mockReset();
  });

  it("reuses existing material and avoids duplicate material/job creation", async () => {
    getDocsMock.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: "existing-mat-1" }],
    });

    render(<VideoRegistrationForm />);

    fireEvent.change(screen.getByLabelText("YouTube URL"), {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "教材を作成" }));

    await waitFor(() => {
      expect(addDocMock).not.toHaveBeenCalled();
      expect(setDocMock).not.toHaveBeenCalled();
      expect(pushMock).toHaveBeenCalledWith("/materials/existing-mat-1");
    });
  });

  it("creates material + queued job and routes to learning page", async () => {
    addDocMock.mockResolvedValueOnce({ id: "mat1" });
    getDocsMock.mockResolvedValueOnce({ empty: true, docs: [] });
    getDocMock.mockResolvedValueOnce({ exists: () => false });
    setDocMock.mockResolvedValueOnce(undefined);

    render(<VideoRegistrationForm />);

    fireEvent.change(screen.getByLabelText("YouTube URL"), {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "教材を作成" }));

    await waitFor(() => {
      expect(addDocMock).toHaveBeenCalledTimes(1);
      expect(setDocMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/materials/mat1");
    });
  });
});
