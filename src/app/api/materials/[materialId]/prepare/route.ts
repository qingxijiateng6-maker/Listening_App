import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { MATERIAL_PIPELINE_VERSION } from "@/lib/constants";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildMaterialPipelineJobId } from "@/lib/jobs/idempotency";
import {
  createWorkerId,
  enqueueMaterialPipelineJob,
  isLockStale,
  runJobToCompletion,
} from "@/lib/jobs/queue";
import { getMaterial } from "@/lib/server/materials";
import { resolveRequestUser } from "@/lib/server/requestUser";
import type { Material, MaterialStatus } from "@/types/domain";

export const runtime = "nodejs";

type JobRecord = {
  status: "queued" | "processing" | "done" | "failed";
  nextRunAt: Timestamp;
  lockedAt?: Timestamp;
};

function isTerminalStatus(status: MaterialStatus | undefined): boolean {
  return status === "ready" || status === "failed" || status === "cancelled";
}

function buildPrepareResponse(material: Material, error?: string) {
  return NextResponse.json({
    status: material.status,
    pipelineState: material.pipelineState,
    shouldContinuePolling: !isTerminalStatus(material.status),
    error: error ?? "",
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ materialId: string }> },
) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { materialId } = await params;
  if (!materialId) {
    return NextResponse.json({ error: "materialId is required" }, { status: 400 });
  }

  const material = await getMaterial(user.uid, materialId);
  if (!material) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  if (isTerminalStatus(material.status)) {
    return buildPrepareResponse(material, material.pipelineState?.errorMessage ?? "");
  }

  const now = Timestamp.now();
  const jobId = buildMaterialPipelineJobId(materialId, MATERIAL_PIPELINE_VERSION);
  const jobSnapshot = await getAdminDb().collection("jobs").doc(jobId).get();

  let shouldRun = false;
  if (!jobSnapshot.exists) {
    await enqueueMaterialPipelineJob(materialId);
    shouldRun = true;
  } else {
    const job = jobSnapshot.data() as JobRecord;
    if (job.status === "queued") {
      shouldRun = job.nextRunAt.toMillis() <= now.toMillis();
    } else if (job.status === "processing") {
      shouldRun = isLockStale(job.lockedAt, now);
    }
  }

  if (shouldRun) {
    await runJobToCompletion(jobId, createWorkerId("material-prepare"));
  }

  const latestMaterial = (await getMaterial(user.uid, materialId)) ?? material;
  return buildPrepareResponse(latestMaterial, latestMaterial.pipelineState?.errorMessage ?? "");
}
