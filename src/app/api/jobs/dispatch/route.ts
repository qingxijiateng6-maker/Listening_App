import { NextRequest, NextResponse } from "next/server";
import { JOB_DISPATCH_BATCH_SIZE } from "@/lib/constants";
import { createWorkerId, dispatchJobs } from "@/lib/jobs/queue";
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

  const workerId = createWorkerId("dispatch");
  const result = await dispatchJobs(limitCount, workerId);
  return NextResponse.json(result);
}
