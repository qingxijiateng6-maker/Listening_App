import { Timestamp } from "firebase-admin/firestore";
import { MATERIAL_PIPELINE_VERSION } from "@/lib/constants";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildMaterialPipelineJobId } from "@/lib/jobs/idempotency";
import type { JobStep } from "@/types/domain";

type JobRecord = {
  type: "material_pipeline";
  materialId: string;
  pipelineVersion: string;
  status: "queued";
  step: JobStep;
  attempt: number;
  nextRunAt: Timestamp;
  lockedBy: string;
  lockedAt: Timestamp;
  errorCode: string;
  errorMessage: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

type MaterialRecord = {
  status?: "queued" | "processing" | "ready" | "failed" | "cancelled";
  pipelineVersion?: string;
  updatedAt?: Timestamp;
  pipelineState?: {
    currentStep: JobStep;
    lastCompletedStep: JobStep | null;
    status: "queued";
    updatedAt: Timestamp;
    errorCode: string;
    errorMessage: string;
  };
};

function nowTs(): Timestamp {
  return Timestamp.now();
}

function firstStep(): JobStep {
  return "meta";
}

export async function enqueueMaterialPipelineJob(materialId: string): Promise<string> {
  const db = getAdminDb();
  const now = nowTs();
  const jobId = buildMaterialPipelineJobId(materialId, MATERIAL_PIPELINE_VERSION);
  const jobRef = db.collection("jobs").doc(jobId);
  const materialRef = db.collection("materials").doc(materialId);

  await db.runTransaction(async (tx) => {
    const [existing, materialSnap] = await Promise.all([tx.get(jobRef), tx.get(materialRef)]);
    if (existing.exists) {
      return;
    }

    if (materialSnap.exists) {
      const material = materialSnap.data() as MaterialRecord;
      if (material.status === "ready" && material.pipelineVersion === MATERIAL_PIPELINE_VERSION) {
        return;
      }
    }

    const job: JobRecord = {
      type: "material_pipeline",
      materialId,
      pipelineVersion: MATERIAL_PIPELINE_VERSION,
      status: "queued",
      step: firstStep(),
      attempt: 0,
      nextRunAt: now,
      lockedBy: "",
      lockedAt: now,
      errorCode: "",
      errorMessage: "",
      createdAt: now,
      updatedAt: now,
    };
    tx.create(jobRef, job);

    if (!materialSnap.exists) {
      return;
    }

    tx.update(materialRef, {
      status: "queued",
      pipelineVersion: MATERIAL_PIPELINE_VERSION,
      updatedAt: now,
      pipelineState: {
        currentStep: firstStep(),
        lastCompletedStep: null,
        status: "queued",
        updatedAt: now,
        errorCode: "",
        errorMessage: "",
      },
    } satisfies MaterialRecord);
  });

  return jobId;
}
