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
  ownerUid: string;
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

function serializeTimestamp(timestamp: Timestamp | null | undefined): string | null {
  if (!timestamp) {
    return null;
  }

  return timestamp.toDate().toISOString();
}

export async function GET(request: NextRequest) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  const snapshot = await db.collection("materials").where("ownerUid", "==", user.uid).get();
  const materialDocs = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      material: doc.data() as MaterialRecord,
    }))
    .sort(
      (left, right) =>
        (right.material.updatedAt?.toMillis?.() ?? 0) - (left.material.updatedAt?.toMillis?.() ?? 0),
    )
    .slice(0, 50);

  return NextResponse.json({
    materials: materialDocs.map(({ id, material }) => {
      return {
        materialId: id,
        youtubeUrl: material.youtubeUrl,
        youtubeId: material.youtubeId,
        title: material.title,
        channel: material.channel,
        status: material.status,
        pipelineVersion: material.pipelineVersion,
        updatedAt: serializeTimestamp(material.updatedAt),
      };
    }),
  });
}

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
  const existingSnapshot = await db.collection("materials").where("ownerUid", "==", user.uid).get();
  const existingDoc = existingSnapshot.docs.find((doc) => {
    const material = doc.data() as Partial<MaterialRecord>;
    return material.youtubeId === parsed.youtubeId && material.pipelineVersion === MATERIAL_PIPELINE_VERSION;
  });

  let materialId = existingDoc?.id ?? "";
  let materialStatus: MaterialRecord["status"] = !existingDoc
    ? "queued"
    : (((existingDoc.data() as MaterialRecord).status ?? "queued") as MaterialRecord["status"]);

  if (!existingDoc) {
    const now = Timestamp.now();
    const materialRef = db.collection("materials").doc();
    const material: MaterialRecord = {
      ownerUid: user.uid,
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
    reused: Boolean(existingDoc),
  });
}
