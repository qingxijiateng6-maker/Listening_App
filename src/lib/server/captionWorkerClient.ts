import { assertServerOnly } from "@/lib/server/assertServerOnly";

assertServerOnly("captionWorkerClient");

const CAPTION_WORKER_DISPATCH_PATH = "internal/jobs/dispatch";
const CAPTION_WORKER_WAKE_TIMEOUT_MS = 1_500;
const WAKE_FAILURE_LOG_WINDOW_MS = 60_000;

type CaptionWorkerWakeFailureReason = "missing_config" | "http_error" | "network_error" | "timeout";

export type CaptionWorkerWakeResult =
  | {
      ok: true;
      status: number;
    }
  | {
      ok: false;
      reason: CaptionWorkerWakeFailureReason;
      status?: number;
      message?: string;
    };

let lastWakeFailureKey = "";
let lastWakeFailureAt = 0;

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function shouldLogWakeFailure(key: string): boolean {
  const now = Date.now();
  if (lastWakeFailureKey === key && now - lastWakeFailureAt < WAKE_FAILURE_LOG_WINDOW_MS) {
    return false;
  }

  lastWakeFailureKey = key;
  lastWakeFailureAt = now;
  return true;
}

function logWakeFailure(key: string, message: string, details?: Record<string, unknown>): void {
  if (!shouldLogWakeFailure(key)) {
    return;
  }

  console.warn("Caption worker wake ping failed.", {
    message,
    ...details,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function wakeCaptionWorker(): Promise<CaptionWorkerWakeResult> {
  const baseUrl = normalizeBaseUrl(process.env.CAPTION_WORKER_BASE_URL ?? "");
  const token = (process.env.CAPTION_WORKER_TOKEN ?? "").trim();

  if (!baseUrl || !token) {
    logWakeFailure("missing_config", "CAPTION_WORKER_BASE_URL or CAPTION_WORKER_TOKEN is not configured.");
    return {
      ok: false,
      reason: "missing_config",
      message: "Missing worker configuration.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, CAPTION_WORKER_WAKE_TIMEOUT_MS);

  try {
    const endpoint = new URL(CAPTION_WORKER_DISPATCH_PATH, baseUrl).toString();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ limit: 1 }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      logWakeFailure(`http_error:${response.status}`, "Worker wake ping returned a non-2xx response.", {
        status: response.status,
      });
      return {
        ok: false,
        reason: "http_error",
        status: response.status,
        message: `Worker wake ping returned ${response.status}.`,
      };
    }

    return {
      ok: true,
      status: response.status,
    };
  } catch (error) {
    if (isAbortError(error)) {
      logWakeFailure("timeout", "Worker wake ping timed out.", {
        timeoutMs: CAPTION_WORKER_WAKE_TIMEOUT_MS,
      });
      return {
        ok: false,
        reason: "timeout",
        message: "Worker wake ping timed out.",
      };
    }

    const message = error instanceof Error ? error.message : "Unknown worker wake failure.";
    logWakeFailure(`network_error:${message}`, "Worker wake ping threw a network error.", { error: message });
    return {
      ok: false,
      reason: "network_error",
      message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
