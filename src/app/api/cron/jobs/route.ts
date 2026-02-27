import { NextRequest, NextResponse } from "next/server";
import { JOB_DISPATCH_BATCH_SIZE } from "@/lib/constants";
import { createWorkerId, dispatchJobs } from "@/lib/jobs/queue";
import { isAuthorizedCronRequest } from "@/lib/server/internalAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dispatchResult = await dispatchJobs(JOB_DISPATCH_BATCH_SIZE, createWorkerId("cron"));
  if (dispatchResult.lockedJobIds.length === 0) {
    return NextResponse.json({
      reclaimedStaleLocks: dispatchResult.reclaimedStaleLocks,
      dispatched: 0,
      processed: [],
    });
  }

  const workerSecret = process.env.WORKER_SECRET ?? "";
  if (!workerSecret) {
    return NextResponse.json(
      {
        error: "Missing WORKER_SECRET",
        reclaimedStaleLocks: dispatchResult.reclaimedStaleLocks,
        lockedJobIds: dispatchResult.lockedJobIds,
      },
      { status: 500 },
    );
  }

  const workerUrl = new URL("/api/worker/material-pipeline", request.nextUrl.origin).toString();
  const processed = await Promise.all(
    dispatchResult.lockedJobIds.map(async (jobId) => {
      const response = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({ jobId }),
      });

      const payload = (await response.json()) as { result?: string; error?: string };
      return {
        jobId,
        status: response.status,
        result: payload.result ?? "unknown",
        error: payload.error ?? "",
      };
    }),
  );

  return NextResponse.json({
    reclaimedStaleLocks: dispatchResult.reclaimedStaleLocks,
    dispatched: dispatchResult.lockedJobIds.length,
    processed,
  });
}
