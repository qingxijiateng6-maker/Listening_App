import { Timestamp } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/materials/[materialId]/prepare/route";

const resolveRequestUserMock = vi.fn();
const getMaterialMock = vi.fn();
const getAdminDbMock = vi.fn();
const createWorkerIdMock = vi.fn();
const enqueueMaterialPipelineJobMock = vi.fn();
const isLockStaleMock = vi.fn();
const runJobToCompletionMock = vi.fn();

vi.mock("@/lib/server/requestUser", () => ({
  resolveRequestUser: (...args: unknown[]) => resolveRequestUserMock(...args),
}));

vi.mock("@/lib/server/materials", () => ({
  getMaterial: (...args: unknown[]) => getMaterialMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => getAdminDbMock(),
}));

vi.mock("@/lib/jobs/queue", () => ({
  createWorkerId: (...args: unknown[]) => createWorkerIdMock(...args),
  enqueueMaterialPipelineJob: (...args: unknown[]) => enqueueMaterialPipelineJobMock(...args),
  isLockStale: (...args: unknown[]) => isLockStaleMock(...args),
  runJobToCompletion: (...args: unknown[]) => runJobToCompletionMock(...args),
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

function mockJobSnapshot(data: Record<string, unknown> | null) {
  return {
    exists: data !== null,
    data: () => data,
  };
}

describe("POST /api/materials/[materialId]/prepare", () => {
  beforeEach(() => {
    resolveRequestUserMock.mockReset();
    getMaterialMock.mockReset();
    getAdminDbMock.mockReset();
    createWorkerIdMock.mockReset();
    enqueueMaterialPipelineJobMock.mockReset();
    isLockStaleMock.mockReset();
    runJobToCompletionMock.mockReset();
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

  it("returns terminal materials without enqueuing", async () => {
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

    expect(enqueueMaterialPipelineJobMock).not.toHaveBeenCalled();
    expect(runJobToCompletionMock).not.toHaveBeenCalled();
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

  it("self-heals a missing job and runs the queue", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    createWorkerIdMock.mockReturnValueOnce("worker-1");
    enqueueMaterialPipelineJobMock.mockResolvedValueOnce("job-1");
    runJobToCompletionMock.mockResolvedValueOnce({ result: "done" });
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
    getAdminDbMock.mockReturnValue({
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(mockJobSnapshot(null)),
        }),
      }),
    });

    const response = await POST(new NextRequest("http://localhost/api/materials/mat-1/prepare"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(enqueueMaterialPipelineJobMock).toHaveBeenCalledWith("mat-1");
    expect(runJobToCompletionMock).toHaveBeenCalledWith("material_pipeline:mat-1:v2", "worker-1");
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

  it("does not re-run a fresh processing job", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    getMaterialMock
      .mockResolvedValueOnce(buildMaterial())
      .mockResolvedValueOnce(buildMaterial());
    isLockStaleMock.mockReturnValueOnce(false);
    getAdminDbMock.mockReturnValue({
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(
            mockJobSnapshot({
              status: "processing",
              nextRunAt: Timestamp.fromMillis(1_000),
              lockedAt: Timestamp.fromMillis(Date.now()),
            }),
          ),
        }),
      }),
    });

    const response = await POST(new NextRequest("http://localhost/api/materials/mat-1/prepare"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(runJobToCompletionMock).not.toHaveBeenCalled();
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

  it("re-runs a stale processing job", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    createWorkerIdMock.mockReturnValueOnce("worker-2");
    getMaterialMock
      .mockResolvedValueOnce(buildMaterial())
      .mockResolvedValueOnce(buildMaterial());
    isLockStaleMock.mockReturnValueOnce(true);
    runJobToCompletionMock.mockResolvedValueOnce({ result: "processing" });
    getAdminDbMock.mockReturnValue({
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(
            mockJobSnapshot({
              status: "processing",
              nextRunAt: Timestamp.fromMillis(1_000),
              lockedAt: Timestamp.fromMillis(Date.now() - 500_000),
            }),
          ),
        }),
      }),
    });

    const response = await POST(new NextRequest("http://localhost/api/materials/mat-1/prepare"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(runJobToCompletionMock).toHaveBeenCalledWith("material_pipeline:mat-1:v2", "worker-2");
    expect(response.status).toBe(200);
  });
});
