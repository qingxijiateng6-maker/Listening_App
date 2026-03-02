import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET } from "@/app/api/materials/[materialId]/route";

const getMaterialMock = vi.fn();
const deleteMaterialMock = vi.fn();
const resolveRequestUserMock = vi.fn();

vi.mock("@/lib/server/materials", () => ({
  getMaterial: (...args: unknown[]) => getMaterialMock(...args),
  deleteMaterial: (...args: unknown[]) => deleteMaterialMock(...args),
}));

vi.mock("@/lib/server/requestUser", () => ({
  resolveRequestUser: (...args: unknown[]) => resolveRequestUserMock(...args),
}));

describe("GET /api/materials/[materialId]", () => {
  beforeEach(() => {
    getMaterialMock.mockReset();
    deleteMaterialMock.mockReset();
    resolveRequestUserMock.mockReset();
  });

  it("returns 404 when the material does not exist", async () => {
    getMaterialMock.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/api/materials/mat-1"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(getMaterialMock).toHaveBeenCalledWith("mat-1");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Material not found" });
  });

  it("returns the material and status", async () => {
    getMaterialMock.mockResolvedValueOnce({
      materialId: "mat-1",
      youtubeUrl: "https://www.youtube.com/watch?v=abc123",
      youtubeId: "abc123",
      title: "Sample",
      channel: "Channel",
      durationSec: 120,
      status: "ready",
      pipelineVersion: "v1",
      createdAt: { seconds: 10, nanoseconds: 0, toMillis: () => 10000 },
      updatedAt: { seconds: 20, nanoseconds: 0, toMillis: () => 20000 },
    });

    const response = await GET(new Request("http://localhost/api/materials/mat-1"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      material: {
        materialId: "mat-1",
        youtubeUrl: "https://www.youtube.com/watch?v=abc123",
        youtubeId: "abc123",
        title: "Sample",
        channel: "Channel",
        durationSec: 120,
        status: "ready",
        pipelineVersion: "v1",
        createdAt: { seconds: 10, nanoseconds: 0 },
        updatedAt: { seconds: 20, nanoseconds: 0 },
      },
      status: "ready",
    });
  });
});

describe("DELETE /api/materials/[materialId]", () => {
  beforeEach(() => {
    deleteMaterialMock.mockReset();
    resolveRequestUserMock.mockReset();
  });

  it("returns 401 when the user is not authenticated", async () => {
    resolveRequestUserMock.mockResolvedValueOnce(null);

    const response = await DELETE(new Request("http://localhost/api/materials/mat-1"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when the material does not exist", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    deleteMaterialMock.mockResolvedValueOnce(null);

    const response = await DELETE(new Request("http://localhost/api/materials/mat-1"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(deleteMaterialMock).toHaveBeenCalledWith("mat-1");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Material not found" });
  });

  it("deletes the material", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    deleteMaterialMock.mockResolvedValueOnce(true);

    const response = await DELETE(new Request("http://localhost/api/materials/mat-1"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(deleteMaterialMock).toHaveBeenCalledWith("mat-1");
    expect(response.status).toBe(204);
  });
});
