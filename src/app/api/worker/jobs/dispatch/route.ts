import { NextRequest, NextResponse } from "next/server";
import { JOB_DISPATCH_BATCH_SIZE } from "@/lib/constants";
import { createWorkerId, dispatchJobs, runJobToCompletion } from "@/lib/jobs/queue";
import { isAuthorizedCronRequest, isAuthorizedWorkerRequest } from "@/lib/server/internalAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request) && !isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let limitCount = JOB_DISPATCH_BATCH_SIZE;
  try {
    const body = (await request.json()) as { limit?: number };
    if (typeof body.limit === "number" && body.limit > 0 && body.limit <= 20) {
      limitCount = body.limit;
    }
  } catch {
    // body is optional
  }

  const workerId = createWorkerId("worker-dispatch");
  const dispatchResult = await dispatchJobs(limitCount, workerId);

  let processed = 0;
  let failed = 0;
  const results = await Promise.all(
    dispatchResult.lockedJobIds.map(async (jobId) => {
      const result = await runJobToCompletion(jobId, workerId, 1);
      if (result.result === "failed") {
        failed += 1;
      } else {
        processed += 1;
      }
      return { jobId, result: result.result };
    }),
  );

  return NextResponse.json({
    picked: dispatchResult.lockedJobIds.length,
    processed,
    failed,
    reclaimedStaleLocks: dispatchResult.reclaimedStaleLocks,
    results,
  });
}
