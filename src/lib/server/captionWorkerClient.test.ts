import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = {
  CAPTION_WORKER_BASE_URL: process.env.CAPTION_WORKER_BASE_URL,
  CAPTION_WORKER_TOKEN: process.env.CAPTION_WORKER_TOKEN,
};

describe("wakeCaptionWorker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CAPTION_WORKER_BASE_URL = originalEnv.CAPTION_WORKER_BASE_URL;
    process.env.CAPTION_WORKER_TOKEN = originalEnv.CAPTION_WORKER_TOKEN;
  });

  afterEach(() => {
    process.env.CAPTION_WORKER_BASE_URL = originalEnv.CAPTION_WORKER_BASE_URL;
    process.env.CAPTION_WORKER_TOKEN = originalEnv.CAPTION_WORKER_TOKEN;
  });

  it("returns missing_config when the worker env is absent", async () => {
    delete process.env.CAPTION_WORKER_BASE_URL;
    delete process.env.CAPTION_WORKER_TOKEN;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wakeCaptionWorker } = await import("@/lib/server/captionWorkerClient");

    await expect(wakeCaptionWorker()).resolves.toEqual({
      ok: false,
      reason: "missing_config",
      message: "Missing worker configuration.",
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("posts a wake ping to the Cloud Run dispatch endpoint", async () => {
    process.env.CAPTION_WORKER_BASE_URL = "https://caption-worker.example.com";
    process.env.CAPTION_WORKER_TOKEN = "worker-token";

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 202,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { wakeCaptionWorker } = await import("@/lib/server/captionWorkerClient");

    await expect(wakeCaptionWorker()).resolves.toEqual({
      ok: true,
      status: 202,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://caption-worker.example.com/internal/jobs/dispatch",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer worker-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ limit: 1 }),
      }),
    );
  });

  it("returns http_error when the worker replies with a non-2xx status", async () => {
    process.env.CAPTION_WORKER_BASE_URL = "https://caption-worker.example.com/";
    process.env.CAPTION_WORKER_TOKEN = "worker-token";

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("nope", {
        status: 503,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { wakeCaptionWorker } = await import("@/lib/server/captionWorkerClient");

    await expect(wakeCaptionWorker()).resolves.toEqual({
      ok: false,
      reason: "http_error",
      status: 503,
      message: "Worker wake ping returned 503.",
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
