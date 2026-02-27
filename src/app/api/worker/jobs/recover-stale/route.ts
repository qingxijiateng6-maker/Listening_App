import { NextRequest, NextResponse } from "next/server";
import { createWorkerId, reclaimStaleProcessingJobs } from "@/lib/jobs/queue";
import { isAuthorizedCronRequest, isAuthorizedWorkerRequest } from "@/lib/server/internalAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request) && !isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recovered = await reclaimStaleProcessingJobs(createWorkerId("recover-stale"));
  return NextResponse.json({ recovered });
}
