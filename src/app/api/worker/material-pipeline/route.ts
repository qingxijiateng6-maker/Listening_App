import { NextRequest, NextResponse } from "next/server";
import { runSingleJob } from "@/lib/jobs/queue";
import { isAuthorizedWorkerRequest } from "@/lib/server/internalAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { jobId?: string };
  if (!body.jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const result = await runSingleJob(body.jobId);
  return NextResponse.json({ jobId: body.jobId, ...result });
}
