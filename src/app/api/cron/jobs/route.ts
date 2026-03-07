import { NextRequest, NextResponse } from "next/server";
import { JOB_DISPATCH_BATCH_SIZE } from "@/lib/constants";
import { createWorkerId, dispatchJobs, runJobToCompletion } from "@/lib/jobs/queue";
import { isAuthorizedCronRequest } from "@/lib/server/internalAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerId = createWorkerId("cron");
  const dispatchResult = await dispatchJobs(JOB_DISPATCH_BATCH_SIZE, workerId);
  if (dispatchResult.lockedJobIds.length === 0) {
    return NextResponse.json({
      reclaimedStaleLocks: dispatchResult.reclaimedStaleLocks,
      dispatched: 0,
      processed: [],
    });
  }

  const processed = await Promise.all(
    dispatchResult.lockedJobIds.map(async (jobId) => {
      return {
        jobId,
        result: (await runJobToCompletion(jobId, workerId, 1)).result,
      };
    }),
  );

  return NextResponse.json({
    reclaimedStaleLocks: dispatchResult.reclaimedStaleLocks,
    dispatched: dispatchResult.lockedJobIds.length,
    processed,
  });
}
