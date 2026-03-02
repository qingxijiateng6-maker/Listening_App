import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/materials/[materialId]/segments/route";

const listMaterialSegmentsMock = vi.fn();
const resolveRequestUserMock = vi.fn();

vi.mock("@/lib/server/materials", () => ({
  listMaterialSegments: (...args: unknown[]) => listMaterialSegmentsMock(...args),
}));

vi.mock("@/lib/server/requestUser", () => ({
  resolveRequestUser: (...args: unknown[]) => resolveRequestUserMock(...args),
}));

describe("GET /api/materials/[materialId]/segments", () => {
  beforeEach(() => {
    listMaterialSegmentsMock.mockReset();
    resolveRequestUserMock.mockReset();
  });

  it("returns 401 when the user is not authenticated", async () => {
    resolveRequestUserMock.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/api/materials/mat-1/segments"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when the material does not exist", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    listMaterialSegmentsMock.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/api/materials/mat-1/segments"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(listMaterialSegmentsMock).toHaveBeenCalledWith("user-1", "mat-1");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Material not found" });
  });

  it("returns the material segments", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    listMaterialSegmentsMock.mockResolvedValueOnce([
      {
        segmentId: "seg-1",
        startMs: 0,
        endMs: 1000,
        text: "Hello world",
      },
    ]);

    const response = await GET(new Request("http://localhost/api/materials/mat-1/segments"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(listMaterialSegmentsMock).toHaveBeenCalledWith("user-1", "mat-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      segments: [
        {
          segmentId: "seg-1",
          startMs: 0,
          endMs: 1000,
          text: "Hello world",
        },
      ],
    });
  });
});
