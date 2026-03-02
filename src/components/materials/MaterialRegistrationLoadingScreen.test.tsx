import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialRegistrationLoadingScreen } from "@/components/materials/MaterialRegistrationLoadingScreen";

const replaceMock = vi.fn();
const fetchMock = vi.fn();
const buildAuthenticatedRequestHeadersMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () =>
    new URLSearchParams({
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }),
}));

vi.mock("@/lib/firebase/auth", () => ({
  buildAuthenticatedRequestHeaders: () => buildAuthenticatedRequestHeadersMock(),
}));

describe("MaterialRegistrationLoadingScreen", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    fetchMock.mockReset();
    buildAuthenticatedRequestHeadersMock.mockReset();
    buildAuthenticatedRequestHeadersMock.mockResolvedValue({
      "x-user-id": "u1",
      authorization: "Bearer token-1",
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows loading text and routes to the material page after registration", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        materialId: "mat1",
      }),
    });

    render(<MaterialRegistrationLoadingScreen />);

    expect(screen.getByText("読み込み中です...")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/materials",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-user-id": "u1",
            authorization: "Bearer token-1",
          }),
        }),
      );
      expect(replaceMock).toHaveBeenCalledWith("/materials/mat1");
    });
  });
});
