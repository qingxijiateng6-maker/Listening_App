import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/materials/[materialId]/prepare/route";

const resolveRequestUserMock = vi.fn();
const getMaterialMock = vi.fn();
const wakeCaptionWorkerMock = vi.fn();

vi.mock("@/lib/server/requestUser", () => ({
  resolveRequestUser: (...args: unknown[]) => resolveRequestUserMock(...args),
}));

vi.mock("@/lib/server/materials", () => ({
  getMaterial: (...args: unknown[]) => getMaterialMock(...args),
}));

vi.mock("@/lib/server/captionWorkerClient", () => ({
  wakeCaptionWorker: (...args: unknown[]) => wakeCaptionWorkerMock(...args),
}));

function buildMaterial(overrides?: Record<string, unknown>) {
  return {
    materialId: "mat-1",
    youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    youtubeId: "dQw4w9WgXcQ",
    title: "Sample",
    channel: "Channel",
    durationSec: 120,
    status: "processing",
    pipelineVersion: "v2",
    pipelineState: {
      currentStep: "captions",
      lastCompletedStep: "meta",
      status: "processing",
      updatedAt: { seconds: 2, nanoseconds: 0 },
      errorCode: "",
      errorMessage: "",
    },
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedAt: { seconds: 2, nanoseconds: 0 },
    ...overrides,
  };
}

describe("POST /api/materials/[materialId]/prepare", () => {
  beforeEach(() => {
    resolveRequestUserMock.mockReset();
    getMaterialMock.mockReset();
    wakeCaptionWorkerMock.mockReset();
  });

  it("returns 401 when the user is not authenticated", async () => {
    resolveRequestUserMock.mockResolvedValueOnce(null);

    const response = await POST(new NextRequest("http://localhost/api/materials/mat-1/prepare"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when the material does not exist", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    getMaterialMock.mockResolvedValueOnce(null);

    const response = await POST(new NextRequest("http://localhost/api/materials/mat-1/prepare"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Material not found" });
  });

  it("returns terminal materials without waking the worker", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    getMaterialMock.mockResolvedValueOnce(
      buildMaterial({
        status: "ready",
        pipelineState: {
          currentStep: "format",
          lastCompletedStep: "format",
          status: "ready",
          updatedAt: { seconds: 2, nanoseconds: 0 },
          errorCode: "",
          errorMessage: "",
        },
      }),
    );

    const response = await POST(new NextRequest("http://localhost/api/materials/mat-1/prepare"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(wakeCaptionWorkerMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      pipelineState: {
        currentStep: "format",
        lastCompletedStep: "format",
        status: "ready",
        updatedAt: { seconds: 2, nanoseconds: 0 },
        errorCode: "",
        errorMessage: "",
      },
      shouldContinuePolling: false,
      error: "",
    });
  });

  it("refreshes state after waking the caption worker", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    wakeCaptionWorkerMock.mockResolvedValueOnce({ ok: true, status: 200 });
    getMaterialMock
      .mockResolvedValueOnce(buildMaterial())
      .mockResolvedValueOnce(
        buildMaterial({
          status: "ready",
          pipelineState: {
            currentStep: "format",
            lastCompletedStep: "format",
            status: "ready",
            updatedAt: { seconds: 3, nanoseconds: 0 },
            errorCode: "",
            errorMessage: "",
          },
        }),
      );

    const response = await POST(new NextRequest("http://localhost/api/materials/mat-1/prepare"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(wakeCaptionWorkerMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      pipelineState: {
        currentStep: "format",
        lastCompletedStep: "format",
        status: "ready",
        updatedAt: { seconds: 3, nanoseconds: 0 },
        errorCode: "",
        errorMessage: "",
      },
      shouldContinuePolling: false,
      error: "",
    });
  });

  it("keeps polling while the refreshed material is still processing", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    wakeCaptionWorkerMock.mockResolvedValueOnce({ ok: true, status: 200 });
    getMaterialMock
      .mockResolvedValueOnce(buildMaterial())
      .mockResolvedValueOnce(buildMaterial());

    const response = await POST(new NextRequest("http://localhost/api/materials/mat-1/prepare"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(wakeCaptionWorkerMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "processing",
      pipelineState: {
        currentStep: "captions",
        lastCompletedStep: "meta",
        status: "processing",
        updatedAt: { seconds: 2, nanoseconds: 0 },
        errorCode: "",
        errorMessage: "",
      },
      shouldContinuePolling: true,
      error: "",
    });
  });

  it("returns the current material state even when the worker wake ping fails", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    wakeCaptionWorkerMock.mockResolvedValueOnce({
      ok: false,
      reason: "timeout",
      message: "Worker wake ping timed out.",
    });
    getMaterialMock
      .mockResolvedValueOnce(buildMaterial())
      .mockResolvedValueOnce(buildMaterial());

    const response = await POST(new NextRequest("http://localhost/api/materials/mat-1/prepare"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "processing",
      pipelineState: {
        currentStep: "captions",
        lastCompletedStep: "meta",
        status: "processing",
        updatedAt: { seconds: 2, nanoseconds: 0 },
        errorCode: "",
        errorMessage: "",
      },
      shouldContinuePolling: true,
      error: "",
    });
  });
});
