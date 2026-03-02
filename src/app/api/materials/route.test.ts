import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/materials/route";

const resolveRequestUserMock = vi.fn();
const getAdminDbMock = vi.fn();
const buildMaterialPipelineJobIdMock = vi.fn();
const createWorkerIdMock = vi.fn();
const enqueueMaterialPipelineJobMock = vi.fn();
const runJobToCompletionMock = vi.fn();
const parseYouTubeUrlMock = vi.fn();
const isPubliclyAccessibleYouTubeVideoMock = vi.fn();

vi.mock("@/lib/server/requestUser", () => ({
  resolveRequestUser: (...args: unknown[]) => resolveRequestUserMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => getAdminDbMock(),
}));

vi.mock("@/lib/jobs/idempotency", () => ({
  buildMaterialPipelineJobId: (...args: unknown[]) => buildMaterialPipelineJobIdMock(...args),
}));

vi.mock("@/lib/jobs/queue", () => ({
  createWorkerId: (...args: unknown[]) => createWorkerIdMock(...args),
  enqueueMaterialPipelineJob: (...args: unknown[]) => enqueueMaterialPipelineJobMock(...args),
  runJobToCompletion: (...args: unknown[]) => runJobToCompletionMock(...args),
}));

vi.mock("@/lib/youtube", () => ({
  parseYouTubeUrl: (...args: unknown[]) => parseYouTubeUrlMock(...args),
  isPubliclyAccessibleYouTubeVideo: (...args: unknown[]) => isPubliclyAccessibleYouTubeVideoMock(...args),
}));

function toNextRequest(request: Request): Parameters<typeof GET>[0] {
  return request as unknown as Parameters<typeof GET>[0];
}

describe("GET /api/materials", () => {
  beforeEach(() => {
    resolveRequestUserMock.mockReset();
    getAdminDbMock.mockReset();
  });

  it("returns 401 when the user is not authenticated", async () => {
    resolveRequestUserMock.mockResolvedValueOnce(null);

    const response = await GET(toNextRequest(new Request("http://localhost/api/materials")));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns the latest materials for the authenticated user", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    const getMock = vi.fn().mockResolvedValue({
      docs: [
        {
          id: "mat-older",
          data: () => ({
            youtubeUrl: "https://www.youtube.com/watch?v=old-video01",
            youtubeId: "old-video01",
            title: "Older",
            channel: "Channel A",
            status: "ready",
            pipelineVersion: "v1",
            updatedAt: {
              toMillis: () => 1000,
              toDate: () => new Date("2026-03-01T00:00:00.000Z"),
            },
          }),
        },
        {
          id: "mat-newer",
          data: () => ({
            youtubeUrl: "https://www.youtube.com/watch?v=new-video01",
            youtubeId: "new-video01",
            title: "Newer",
            channel: "Channel B",
            status: "processing",
            pipelineVersion: "v1",
            updatedAt: {
              toMillis: () => 2000,
              toDate: () => new Date("2026-03-02T00:00:00.000Z"),
            },
          }),
        },
      ],
    });
    const whereMock = vi.fn().mockReturnValue({ get: getMock });
    getAdminDbMock.mockReturnValue({
      collection: vi.fn().mockReturnValue({
        where: whereMock,
      }),
    });

    const response = await GET(toNextRequest(new Request("http://localhost/api/materials")));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      materials: [
        {
          materialId: "mat-newer",
          youtubeUrl: "https://www.youtube.com/watch?v=new-video01",
          youtubeId: "new-video01",
          title: "Newer",
          channel: "Channel B",
          status: "processing",
          pipelineVersion: "v1",
          updatedAt: "2026-03-02T00:00:00.000Z",
        },
        {
          materialId: "mat-older",
          youtubeUrl: "https://www.youtube.com/watch?v=old-video01",
          youtubeId: "old-video01",
          title: "Older",
          channel: "Channel A",
          status: "ready",
          pipelineVersion: "v1",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("accepts the header fallback user returned by resolveRequestUser", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "fallback-user", source: "x-user-id" });
    const getMock = vi.fn().mockResolvedValue({ docs: [] });
    const whereMock = vi.fn().mockReturnValue({ get: getMock });
    getAdminDbMock.mockReturnValue({
      collection: vi.fn().mockReturnValue({
        where: whereMock,
      }),
    });

    const response = await GET(toNextRequest(new Request("http://localhost/api/materials")));

    expect(response.status).toBe(200);
    expect(whereMock).toHaveBeenCalledWith("ownerUid", "==", "fallback-user");
    await expect(response.json()).resolves.toEqual({ materials: [] });
  });

  it("returns a JSON 500 when the material lookup throws", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    const getMock = vi.fn().mockRejectedValue(new Error("db exploded"));
    const whereMock = vi.fn().mockReturnValue({ get: getMock });
    getAdminDbMock.mockReturnValue({
      collection: vi.fn().mockReturnValue({
        where: whereMock,
      }),
    });

    const response = await GET(toNextRequest(new Request("http://localhost/api/materials")));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "db exploded" });
  });
});

describe("POST /api/materials", () => {
  beforeEach(() => {
    resolveRequestUserMock.mockReset();
    getAdminDbMock.mockReset();
    buildMaterialPipelineJobIdMock.mockReset();
    createWorkerIdMock.mockReset();
    enqueueMaterialPipelineJobMock.mockReset();
    runJobToCompletionMock.mockReset();
    parseYouTubeUrlMock.mockReset();
    isPubliclyAccessibleYouTubeVideoMock.mockReset();
  });

  it("returns 401 when the user is not authenticated", async () => {
    resolveRequestUserMock.mockResolvedValueOnce(null);

    const response = await POST(
      toNextRequest(new Request("http://localhost/api/materials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
      })),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 400 for an invalid youtube url", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    parseYouTubeUrlMock.mockReturnValueOnce(null);

    const response = await POST(
      toNextRequest(new Request("http://localhost/api/materials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ youtubeUrl: "invalid" }),
      })),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "YouTube公開動画のURL形式で入力してください。",
    });
  });

  it("creates a new material and runs the pipeline", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    parseYouTubeUrlMock.mockReturnValueOnce({
      youtubeId: "dQw4w9WgXcQ",
      normalizedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    isPubliclyAccessibleYouTubeVideoMock.mockResolvedValueOnce(true);
    buildMaterialPipelineJobIdMock.mockReturnValueOnce("job-1");
    createWorkerIdMock.mockReturnValueOnce("worker-1");
    enqueueMaterialPipelineJobMock.mockResolvedValueOnce("job-1");
    runJobToCompletionMock.mockResolvedValueOnce({ result: "done" });

    const materialRef = {
      id: "mat-1",
      set: vi.fn().mockResolvedValue(undefined),
    };
    const docMock = vi
      .fn()
      .mockReturnValueOnce(materialRef)
      .mockReturnValueOnce({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ status: "ready" }),
        }),
      });
    const getMock = vi.fn().mockResolvedValue({ docs: [] });
    const whereMock = vi.fn().mockReturnValue({ get: getMock });
    getAdminDbMock.mockReturnValue({
      collection: vi.fn().mockReturnValue({
        where: whereMock,
        doc: docMock,
      }),
    });

    const response = await POST(
      toNextRequest(new Request("http://localhost/api/materials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
      })),
    );

    expect(enqueueMaterialPipelineJobMock).toHaveBeenCalledWith("mat-1");
    expect(runJobToCompletionMock).toHaveBeenCalledWith("job-1", "worker-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      materialId: "mat-1",
      status: "ready",
      jobId: "job-1",
      reused: false,
    });
  });

  it("creates materials for the header fallback user returned by resolveRequestUser", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "fallback-user", source: "x-user-id" });
    parseYouTubeUrlMock.mockReturnValueOnce({
      youtubeId: "dQw4w9WgXcQ",
      normalizedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    isPubliclyAccessibleYouTubeVideoMock.mockResolvedValueOnce(true);
    buildMaterialPipelineJobIdMock.mockReturnValueOnce("job-1");
    createWorkerIdMock.mockReturnValueOnce("worker-1");
    enqueueMaterialPipelineJobMock.mockResolvedValueOnce("job-1");
    runJobToCompletionMock.mockResolvedValueOnce({ result: "done" });

    const setMock = vi.fn().mockResolvedValue(undefined);
    const materialRef = {
      id: "mat-1",
      set: setMock,
    };
    const docMock = vi
      .fn()
      .mockReturnValueOnce(materialRef)
      .mockReturnValueOnce({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ status: "ready" }),
        }),
      });
    const getMock = vi.fn().mockResolvedValue({ docs: [] });
    const whereMock = vi.fn().mockReturnValue({ get: getMock });
    getAdminDbMock.mockReturnValue({
      collection: vi.fn().mockReturnValue({
        where: whereMock,
        doc: docMock,
      }),
    });

    const response = await POST(
      toNextRequest(new Request("http://localhost/api/materials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
      })),
    );

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUid: "fallback-user",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("returns a JSON 500 when material creation throws", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    parseYouTubeUrlMock.mockImplementationOnce(() => {
      throw new Error("youtube import failed");
    });

    const response = await POST(
      toNextRequest(new Request("http://localhost/api/materials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
      })),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "youtube import failed" });
  });
});
