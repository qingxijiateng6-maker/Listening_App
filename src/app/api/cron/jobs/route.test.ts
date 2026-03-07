import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/jobs/route";

const isAuthorizedCronRequestMock = vi.fn();
const createWorkerIdMock = vi.fn();
const dispatchJobsMock = vi.fn();
const runJobToCompletionMock = vi.fn();

vi.mock("@/lib/server/internalAuth", () => ({
  isAuthorizedCronRequest: (...args: unknown[]) => isAuthorizedCronRequestMock(...args),
}));

vi.mock("@/lib/jobs/queue", () => ({
  createWorkerId: (...args: unknown[]) => createWorkerIdMock(...args),
  dispatchJobs: (...args: unknown[]) => dispatchJobsMock(...args),
  runJobToCompletion: (...args: unknown[]) => runJobToCompletionMock(...args),
}));

describe("GET /api/cron/jobs", () => {
  beforeEach(() => {
    isAuthorizedCronRequestMock.mockReset();
    createWorkerIdMock.mockReset();
    dispatchJobsMock.mockReset();
    runJobToCompletionMock.mockReset();
  });

  it("returns 401 when unauthorized", async () => {
    isAuthorizedCronRequestMock.mockReturnValueOnce(false);

    const response = await GET(new NextRequest("http://localhost/api/cron/jobs"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns early when there are no due jobs", async () => {
    isAuthorizedCronRequestMock.mockReturnValueOnce(true);
    createWorkerIdMock.mockReturnValueOnce("cron-worker");
    dispatchJobsMock.mockResolvedValueOnce({
      reclaimedStaleLocks: 1,
      lockedJobIds: [],
    });

    const response = await GET(new NextRequest("http://localhost/api/cron/jobs"));

    expect(dispatchJobsMock).toHaveBeenCalled();
    expect(runJobToCompletionMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      reclaimedStaleLocks: 1,
      dispatched: 0,
      processed: [],
    });
  });

  it("dispatches and runs due jobs directly", async () => {
    isAuthorizedCronRequestMock.mockReturnValueOnce(true);
    createWorkerIdMock.mockReturnValueOnce("cron-worker");
    dispatchJobsMock.mockResolvedValueOnce({
      reclaimedStaleLocks: 0,
      lockedJobIds: ["job-1", "job-2"],
    });
    runJobToCompletionMock
      .mockResolvedValueOnce({ result: "done" })
      .mockResolvedValueOnce({ result: "processing" });

    const response = await GET(new NextRequest("http://localhost/api/cron/jobs"));

    expect(runJobToCompletionMock).toHaveBeenNthCalledWith(1, "job-1", "cron-worker", 1);
    expect(runJobToCompletionMock).toHaveBeenNthCalledWith(2, "job-2", "cron-worker", 1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      reclaimedStaleLocks: 0,
      dispatched: 2,
      processed: [
        { jobId: "job-1", result: "done" },
        { jobId: "job-2", result: "processing" },
      ],
    });
  });
});
