import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { DispatchJobsResponse } from "./contracts.js";
import type { WorkerConfig } from "./config.js";

const config: WorkerConfig = {
  port: 8080,
  workerSecret: "secret",
  dispatchBatchSize: 5,
  jobLockTimeoutMs: 75_000,
  jobMaxAttempts: 6,
  jobBackoffBaseSeconds: 30,
  materialPipelineBatchWriteLimit: 400,
  ytDlpBinary: "yt-dlp",
  ytDlpCookiesPath: "/secrets/youtube-cookies/cookies.txt",
  captionPreferredLangs: ["ja", "en"],
};

describe("createApp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves healthz", async () => {
    const app = createApp({
      config,
      dispatchHandler: {
        dispatchAndProcessDueJobs: vi.fn<() => Promise<DispatchJobsResponse>>(),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });

  it("rejects unauthorized dispatch requests", async () => {
    const dispatchSpy = vi.fn<() => Promise<DispatchJobsResponse>>();
    const app = createApp({
      config,
      dispatchHandler: {
        dispatchAndProcessDueJobs: dispatchSpy,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/jobs/dispatch",
      payload: { limit: 2 },
    });

    expect(response.statusCode).toBe(401);
    expect(dispatchSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("dispatches due jobs when authorized", async () => {
    const responsePayload: DispatchJobsResponse = {
      picked: 1,
      processed: 1,
      failed: 0,
      reclaimedStaleLocks: 0,
      results: [{ jobId: "job-1", result: "done" }],
    };
    const dispatchSpy = vi.fn(async () => responsePayload);
    const app = createApp({
      config,
      dispatchHandler: {
        dispatchAndProcessDueJobs: dispatchSpy,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/jobs/dispatch",
      headers: {
        authorization: "Bearer secret",
      },
      payload: { limit: 2 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(responsePayload);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.mock.calls[0]?.[0]).toBe(2);
    expect(String(dispatchSpy.mock.calls[0]?.[1])).toContain("caption-worker-");
    await app.close();
  });
});
