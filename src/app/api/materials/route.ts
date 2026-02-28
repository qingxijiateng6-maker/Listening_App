import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { MATERIAL_PIPELINE_VERSION } from "@/lib/constants";
import { buildMaterialPipelineJobId } from "@/lib/jobs/idempotency";
import { createWorkerId, enqueueMaterialPipelineJob, runJobToCompletion } from "@/lib/jobs/queue";
import { resolveRequestUser } from "@/lib/server/requestUser";
import { isPubliclyAccessibleYouTubeVideo, parseYouTubeUrl } from "@/lib/youtube";

export const runtime = "nodejs";

type CreateMaterialBody = {
  youtubeUrl?: string;
};

type MaterialRecord = {
  youtubeUrl: string;
  youtubeId: string;
  title: string;
  channel: string;
  durationSec: number;
  status: "queued" | "processing" | "ready" | "failed";
  pipelineVersion: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export async function POST(request: NextRequest) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as CreateMaterialBody;
  const parsed = parseYouTubeUrl(body.youtubeUrl ?? "");
  if (!parsed) {
    return NextResponse.json({ error: "YouTube公開動画のURL形式で入力してください。" }, { status: 400 });
  }

  const isPublic = await isPubliclyAccessibleYouTubeVideo(parsed.youtubeId);
  if (!isPublic) {
    return NextResponse.json({ error: "公開動画URLのみ対応しています。" }, { status: 400 });
  }

  const db = getAdminDb();
  const existingSnapshot = await db
    .collection("materials")
    .where("youtubeId", "==", parsed.youtubeId)
    .where("pipelineVersion", "==", MATERIAL_PIPELINE_VERSION)
    .limit(1)
    .get();

  let materialId = existingSnapshot.empty ? "" : existingSnapshot.docs[0].id;
  let materialStatus: MaterialRecord["status"] = existingSnapshot.empty
    ? "queued"
    : ((existingSnapshot.docs[0].data() as MaterialRecord).status ?? "queued");

  if (existingSnapshot.empty) {
    const now = Timestamp.now();
    const materialRef = db.collection("materials").doc();
    const material: MaterialRecord = {
      youtubeUrl: parsed.normalizedUrl,
      youtubeId: parsed.youtubeId,
      title: "",
      channel: "",
      durationSec: 0,
      status: "queued",
      pipelineVersion: MATERIAL_PIPELINE_VERSION,
      createdAt: now,
      updatedAt: now,
    };
    await materialRef.set(material);
    materialId = materialRef.id;
    materialStatus = material.status;
  }

  const jobId = buildMaterialPipelineJobId(materialId, MATERIAL_PIPELINE_VERSION);
  await enqueueMaterialPipelineJob(materialId);

  if (materialStatus !== "ready") {
    await runJobToCompletion(jobId, createWorkerId("material-create"));
    const materialSnapshot = await db.collection("materials").doc(materialId).get();
    if (materialSnapshot.exists) {
      materialStatus = ((materialSnapshot.data() as MaterialRecord).status ?? materialStatus);
    }
  }

  return NextResponse.json({
    materialId,
    status: materialStatus,
    jobId,
    reused: !existingSnapshot.empty,
  });
}
