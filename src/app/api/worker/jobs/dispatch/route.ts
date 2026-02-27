import { NextRequest, NextResponse } from "next/server";
import { JOB_DISPATCH_BATCH_SIZE } from "@/lib/constants";
import { createWorkerId, dispatchJobs, runSingleJob } from "@/lib/jobs/queue";
import { isAuthorizedCronRequest, isAuthorizedWorkerRequest } from "@/lib/server/internalAuth";

export const runtime = "nodejs";

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

  const dispatchResult = await dispatchJobs(limitCount, createWorkerId("worker-dispatch"));

  let processed = 0;
  let failed = 0;
  const results = await Promise.all(
    dispatchResult.lockedJobIds.map(async (jobId) => {
      const result = await runSingleJob(jobId);
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
