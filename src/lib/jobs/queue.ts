import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import {
  JOB_BACKOFF_BASE_SECONDS,
  JOB_LOCK_TIMEOUT_MS,
  JOB_MAX_ATTEMPTS,
  MATERIAL_PIPELINE_VERSION,
} from "@/lib/constants";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildMaterialPipelineJobId } from "@/lib/jobs/idempotency";
import { runMaterialPipelineStep } from "@/lib/jobs/materialPipeline";
import type { JobStep } from "@/types/domain";

const MATERIAL_PIPELINE_STEPS: JobStep[] = [
  "meta",
  "captions",
  "asr",
  "format",
  "extract",
  "filter",
  "score",
  "reeval",
  "examples",
  "persist",
];

type JobStatus = "queued" | "processing" | "done" | "failed";
type JobType = "material_pipeline" | "glossary_generate";

type JobRecord = {
  type: JobType;
  materialId: string;
  pipelineVersion: string;
  status: JobStatus;
  step: JobStep;
  attempt: number;
  nextRunAt: Timestamp;
  lockedBy?: string;
  lockedAt?: Timestamp;
  errorCode?: string;
  errorMessage?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

type MaterialRecord = {
  pipelineVersion: string;
  status: "queued" | "processing" | "ready" | "failed";
  updatedAt: Timestamp;
};

export type DispatchResult = {
  reclaimedStaleLocks: number;
  lockedJobIds: string[];
};

function nowTs(): Timestamp {
  return Timestamp.now();
}

function nextStep(step: JobStep): JobStep | null {
  const index = MATERIAL_PIPELINE_STEPS.indexOf(step);
  if (index < 0 || index === MATERIAL_PIPELINE_STEPS.length - 1) {
    return null;
  }
  return MATERIAL_PIPELINE_STEPS[index + 1] ?? null;
}

export function computeBackoffSeconds(attempt: number): number {
  return JOB_BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attempt - 1);
}

export function isLockStale(lockedAt: Timestamp | undefined, now: Timestamp): boolean {
  if (!lockedAt) {
    return true;
  }
  return now.toMillis() - lockedAt.toMillis() > JOB_LOCK_TIMEOUT_MS;
}

export async function reclaimStaleProcessingJobs(workerId: string): Promise<number> {
  const db = getAdminDb();
  const now = nowTs();
  const staleBefore = Timestamp.fromMillis(now.toMillis() - JOB_LOCK_TIMEOUT_MS);
  const snapshot = await db
    .collection("jobs")
    .where("status", "==", "processing")
    .where("lockedAt", "<=", staleBefore)
    .limit(50)
    .get();

  if (snapshot.empty) {
    return 0;
  }

  const updates = snapshot.docs.map(async (jobDoc) => {
    await db.runTransaction(async (tx) => {
      const latest = await tx.get(jobDoc.ref);
      if (!latest.exists) {
        return;
      }
      const job = latest.data() as JobRecord;
      if (job.status !== "processing" || !isLockStale(job.lockedAt, now)) {
        return;
      }
      tx.update(jobDoc.ref, {
        status: "queued",
        nextRunAt: now,
        lockedBy: "",
        lockedAt: now,
        updatedAt: now,
        errorCode: "stale_lock_reclaimed",
        errorMessage: `Reclaimed by ${workerId}`,
      });
    });
  });

  await Promise.all(updates);
  return snapshot.size;
}

export async function lockDueJobs(limitCount: number, workerId: string): Promise<string[]> {
  const db = getAdminDb();
  const now = nowTs();
  const snapshot = await db
    .collection("jobs")
    .where("status", "==", "queued")
    .where("nextRunAt", "<=", now)
    .orderBy("nextRunAt", "asc")
    .limit(limitCount)
    .get();

  if (snapshot.empty) {
    return [];
  }

  const lockedJobIds: string[] = [];
  await Promise.all(
    snapshot.docs.map(async (jobDoc) => {
      await db.runTransaction(async (tx) => {
        const latest = await tx.get(jobDoc.ref);
        if (!latest.exists) {
          return;
        }
        const job = latest.data() as JobRecord;
        if (job.status !== "queued" || job.nextRunAt.toMillis() > now.toMillis()) {
          return;
        }

        const duplicateSnapshot = await tx.get(
          db
            .collection("jobs")
            .where("type", "==", job.type)
            .where("materialId", "==", job.materialId)
            .where("pipelineVersion", "==", job.pipelineVersion)
            .where("status", "in", ["processing", "done"])
            .limit(5),
        );

        const hasOtherDone = duplicateSnapshot.docs.some(
          (docSnap) => docSnap.id !== jobDoc.id && (docSnap.data() as JobRecord).status === "done",
        );
        if (hasOtherDone) {
          tx.update(jobDoc.ref, {
            status: "done",
            updatedAt: now,
            lockedBy: "",
            lockedAt: now,
            errorCode: "duplicate_job_skipped",
            errorMessage: "Skipped because an equivalent job is already done.",
          });
          return;
        }

        const hasOtherActiveProcessing = duplicateSnapshot.docs.some((docSnap) => {
          if (docSnap.id === jobDoc.id) {
            return false;
          }
          const duplicateJob = docSnap.data() as JobRecord;
          return duplicateJob.status === "processing" && !isLockStale(duplicateJob.lockedAt, now);
        });
        if (hasOtherActiveProcessing) {
          tx.update(jobDoc.ref, {
            nextRunAt: Timestamp.fromMillis(now.toMillis() + JOB_BACKOFF_BASE_SECONDS * 1000),
            updatedAt: now,
            errorCode: "duplicate_processing_detected",
            errorMessage: "Equivalent job is currently processing.",
          });
          return;
        }

        tx.update(jobDoc.ref, {
          status: "processing",
          lockedBy: workerId,
          lockedAt: now,
          updatedAt: now,
        });
        lockedJobIds.push(jobDoc.id);
      });
    }),
  );

  return lockedJobIds;
}

export async function dispatchJobs(limitCount: number, workerId: string): Promise<DispatchResult> {
  const reclaimedStaleLocks = await reclaimStaleProcessingJobs(workerId);
  const lockedJobIds = await lockDueJobs(limitCount, workerId);
  return { reclaimedStaleLocks, lockedJobIds };
}

async function markJobDone(jobId: string): Promise<void> {
  const db = getAdminDb();
  await db.collection("jobs").doc(jobId).update({
    status: "done",
    updatedAt: nowTs(),
    lockedBy: "",
    errorCode: "",
    errorMessage: "",
  });
}

async function markJobQueuedForRetry(jobId: string, attempt: number, error: unknown): Promise<void> {
  const db = getAdminDb();
  const nextAttempt = attempt + 1;
  const nextRunAt = Timestamp.fromMillis(
    Date.now() + computeBackoffSeconds(nextAttempt) * 1000,
  );
  const isPermanentFailure = nextAttempt >= JOB_MAX_ATTEMPTS;

  await db.collection("jobs").doc(jobId).update({
    status: isPermanentFailure ? "failed" : "queued",
    attempt: nextAttempt,
    nextRunAt,
    updatedAt: nowTs(),
    lockedBy: "",
    errorCode: "step_failed",
    errorMessage: error instanceof Error ? error.message : "Unknown worker failure",
  });
}

async function progressMaterialPipeline(jobId: string, job: JobRecord): Promise<void> {
  const db = getAdminDb();
  const materialRef = db.collection("materials").doc(job.materialId);
  const jobRef = db.collection("jobs").doc(jobId);
  const now = nowTs();

  await runMaterialPipelineStep({
    materialId: job.materialId,
    pipelineVersion: job.pipelineVersion,
    step: job.step,
  });

  await db.runTransaction(async (tx) => {
    const [materialSnap, jobSnap] = await Promise.all([tx.get(materialRef), tx.get(jobRef)]);
    if (!jobSnap.exists) {
      throw new Error("Job not found.");
    }
    if (!materialSnap.exists) {
      throw new Error("Material not found.");
    }

    const latestJob = jobSnap.data() as JobRecord;
    const material = materialSnap.data() as MaterialRecord;

    if (latestJob.status !== "processing") {
      throw new Error("Job is not locked for processing.");
    }
    if (latestJob.type !== "material_pipeline") {
      throw new Error("Unsupported job type for this worker.");
    }

    // idempotency: already completed with the same pipeline version
    if (
      material.status === "ready" &&
      material.pipelineVersion === latestJob.pipelineVersion &&
      latestJob.pipelineVersion === MATERIAL_PIPELINE_VERSION
    ) {
      tx.update(jobRef, {
        status: "done",
        updatedAt: now,
        lockedBy: "",
        errorCode: "",
        errorMessage: "",
      });
      return;
    }

    const next = nextStep(latestJob.step);
    const isCompleted = next === null;

    tx.update(materialRef, {
      status: isCompleted ? "ready" : "processing",
      pipelineVersion: latestJob.pipelineVersion,
      updatedAt: now,
      pipelineState: {
        currentStep: isCompleted ? latestJob.step : next,
        lastCompletedStep: latestJob.step,
        updatedAt: now,
      },
    });

    tx.update(jobRef, {
      status: isCompleted ? "done" : "processing",
      step: isCompleted ? latestJob.step : next,
      updatedAt: now,
      lockedBy: isCompleted ? "" : latestJob.lockedBy,
      lockedAt: now,
      errorCode: "",
      errorMessage: "",
    });
  });
}

export async function runSingleJob(jobId: string): Promise<{
  result: "done" | "processing" | "failed";
}> {
  const db = getAdminDb();
  const jobRef = db.collection("jobs").doc(jobId);
  const snapshot = await jobRef.get();
  if (!snapshot.exists) {
    return { result: "failed" };
  }

  const job = snapshot.data() as JobRecord;
  if (job.status !== "processing") {
    return { result: "failed" };
  }

  try {
    if (job.type === "material_pipeline") {
      await progressMaterialPipeline(jobId, job);
      const latest = await jobRef.get();
      const latestJob = latest.data() as JobRecord | undefined;
      if (!latestJob) {
        return { result: "failed" };
      }
      return { result: latestJob.status === "done" ? "done" : "processing" };
    }

    await markJobDone(jobId);
    return { result: "done" };
  } catch (error) {
    await markJobQueuedForRetry(jobId, job.attempt, error);
    return { result: "failed" };
  }
}

export async function enqueueMaterialPipelineJob(materialId: string): Promise<string> {
  const db = getAdminDb();
  const now = nowTs();
  const jobId = buildMaterialPipelineJobId(materialId, MATERIAL_PIPELINE_VERSION);
  const jobRef = db.collection("jobs").doc(jobId);

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(jobRef);
    if (existing.exists) {
      return;
    }
    tx.create(jobRef, {
      type: "material_pipeline",
      materialId,
      pipelineVersion: MATERIAL_PIPELINE_VERSION,
      status: "queued",
      step: "meta",
      attempt: 0,
      nextRunAt: now,
      lockedBy: "",
      lockedAt: now,
      errorCode: "",
      errorMessage: "",
      createdAt: now,
      updatedAt: now,
    });
  });

  return jobId;
}

export function createWorkerId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function serverTimestamp(): FieldValue {
  return FieldValue.serverTimestamp();
}
