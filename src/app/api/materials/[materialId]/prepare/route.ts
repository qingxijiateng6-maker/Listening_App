import { NextRequest, NextResponse } from "next/server";
import { wakeCaptionWorker } from "@/lib/server/captionWorkerClient";
import { getMaterial } from "@/lib/server/materials";
import { resolveRequestUser } from "@/lib/server/requestUser";
import type { Material, MaterialStatus } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  await wakeCaptionWorker();

  const latestMaterial = (await getMaterial(user.uid, materialId)) ?? material;
  return buildPrepareResponse(latestMaterial, latestMaterial.pipelineState?.errorMessage ?? "");
}
