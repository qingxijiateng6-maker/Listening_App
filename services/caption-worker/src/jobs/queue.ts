import { randomUUID } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { WorkerConfig } from "../config.js";
import type { JobRecord, JobStep, MaterialRecord } from "../contracts.js";
import type { Logger } from "../logging.js";
import { MaterialPipelineService } from "../pipeline/materialPipeline.js";

const MATERIAL_PIPELINE_STEPS: JobStep[] = ["meta", "captions", "format"];

type PipelineProgressState = {
  materialStatus: NonNullable<MaterialRecord["status"]>;
  jobStatus: NonNullable<JobRecord["status"]>;
  jobStep: JobStep;
  pipelineState: NonNullable<MaterialRecord["pipelineState"]>;
};

type JobFailureDetails = {
  nextAttempt: number;
  nextRunAt: Timestamp;
  isPermanentFailure: boolean;
  errorCode: string;
  errorMessage: string;
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

function lastStep(): JobStep {
  return MATERIAL_PIPELINE_STEPS[MATERIAL_PIPELINE_STEPS.length - 1] ?? "format";
}

function isFreshProcessingJob(
  job: Pick<JobRecord, "status" | "lockedBy" | "lockedAt">,
  workerId: string,
  now: Timestamp,
  lockTimeoutMs: number,
): boolean {
  return job.status === "processing" && job.lockedBy !== workerId && !isLockStale(job.lockedAt, now, lockTimeoutMs);
}

export function computeBackoffSeconds(attempt: number, baseSeconds: number): number {
  return baseSeconds * 2 ** Math.max(0, attempt - 1);
}

export function isLockStale(
  lockedAt: Timestamp | undefined,
  now: Timestamp,
  lockTimeoutMs: number,
): boolean {
  if (!lockedAt) {
    return true;
  }
  return now.toMillis() - lockedAt.toMillis() > lockTimeoutMs;
}

export function buildPipelineProgressState(step: JobStep, now: Timestamp): PipelineProgressState {
  const next = nextStep(step);
  const isCompleted = next === null;
  const materialStatus: NonNullable<MaterialRecord["status"]> = isCompleted ? "ready" : "processing";
  const currentStep = isCompleted ? step : next;

  return {
    materialStatus,
    jobStatus: isCompleted ? "done" : "processing",
    jobStep: currentStep,
    pipelineState: {
      currentStep,
      lastCompletedStep: step,
      status: materialStatus,
      updatedAt: now,
      errorCode: "",
      errorMessage: "",
    },
  };
}

export function buildJobFailureDetails(
  step: JobStep,
  attempt: number,
  error: unknown,
  config: WorkerConfig,
): JobFailureDetails {
  const nextAttempt = attempt + 1;
  const nextRunAt = Timestamp.fromMillis(
    Date.now() + computeBackoffSeconds(nextAttempt, config.jobBackoffBaseSeconds) * 1000,
  );
  const isPermanentFailure = nextAttempt >= config.jobMaxAttempts;
  const failureStage = isPermanentFailure ? "failed" : "retrying";
  const reason = error instanceof Error ? error.message : "Unknown worker failure";
  const detailCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
      ? ((error as { code: string }).code ?? "").trim()
      : "";

  return {
    nextAttempt,
    nextRunAt,
    isPermanentFailure,
    errorCode: detailCode
      ? `material_pipeline_${step}_${detailCode}_${failureStage}`
      : `material_pipeline_${step}_${failureStage}`,
    errorMessage: `material pipeline step "${step}" ${failureStage} on attempt ${nextAttempt}/${config.jobMaxAttempts}: ${reason}`,
  };
}

export class JobQueueService {
  constructor(
    private readonly db: Firestore,
    private readonly pipeline: MaterialPipelineService,
    private readonly config: WorkerConfig,
    private readonly logger: Logger,
  ) {}

  async reclaimStaleProcessingJobs(workerId: string): Promise<number> {
    const now = nowTs();
    const staleBefore = Timestamp.fromMillis(now.toMillis() - this.config.jobLockTimeoutMs);
    const snapshot = await this.db
      .collection("jobs")
      .where("status", "==", "processing")
      .where("lockedAt", "<=", staleBefore)
      .limit(50)
      .get();

    if (snapshot.empty) {
      return 0;
    }

    await Promise.all(
      snapshot.docs.map(async (jobDoc) => {
        await this.db.runTransaction(async (tx) => {
          const latest = await tx.get(jobDoc.ref);
          if (!latest.exists) {
            return;
          }

          const job = latest.data() as JobRecord;
          if (job.status !== "processing" || !isLockStale(job.lockedAt, now, this.config.jobLockTimeoutMs)) {
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
      }),
    );

    return snapshot.size;
  }

  async lockDueJobs(limitCount: number, workerId: string): Promise<string[]> {
    const now = nowTs();
    const snapshot = await this.db
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
        await this.db.runTransaction(async (tx) => {
          const latest = await tx.get(jobDoc.ref);
          if (!latest.exists) {
            return;
          }

          const job = latest.data() as JobRecord;
          if (job.status !== "queued" || job.nextRunAt.toMillis() > now.toMillis()) {
            return;
          }

          const duplicateSnapshot = await tx.get(
            this.db
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
            return (
              duplicateJob.status === "processing" &&
              !isLockStale(duplicateJob.lockedAt, now, this.config.jobLockTimeoutMs)
            );
          });
          if (hasOtherActiveProcessing) {
            tx.update(jobDoc.ref, {
              nextRunAt: Timestamp.fromMillis(
                now.toMillis() + this.config.jobBackoffBaseSeconds * 1000,
              ),
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

  async lockJobById(jobId: string, workerId: string): Promise<boolean> {
    const now = nowTs();
    const jobRef = this.db.collection("jobs").doc(jobId);
    let locked = false;

    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(jobRef);
      if (!snapshot.exists) {
        return;
      }

      const job = snapshot.data() as JobRecord;
      if (job.status === "done") {
        return;
      }
      if (job.status === "processing" && !isLockStale(job.lockedAt, now, this.config.jobLockTimeoutMs)) {
        return;
      }

      tx.update(jobRef, {
        status: "processing",
        lockedBy: workerId,
        lockedAt: now,
        updatedAt: now,
      });
      locked = true;
    });

    return locked;
  }

  async dispatchJobs(limitCount: number, workerId: string): Promise<DispatchResult> {
    const reclaimedStaleLocks = await this.reclaimStaleProcessingJobs(workerId);
    const lockedJobIds = await this.lockDueJobs(limitCount, workerId);
    return { reclaimedStaleLocks, lockedJobIds };
  }

  private async markJobDone(jobId: string): Promise<void> {
    await this.db.collection("jobs").doc(jobId).update({
      status: "done",
      updatedAt: nowTs(),
      lockedBy: "",
      errorCode: "",
      errorMessage: "",
    });
  }

  private async markJobQueuedForRetry(jobId: string, attempt: number, error: unknown): Promise<void> {
    const now = nowTs();
    const jobRef = this.db.collection("jobs").doc(jobId);

    await this.db.runTransaction(async (tx) => {
      const jobSnap = await tx.get(jobRef);
      if (!jobSnap.exists) {
        return;
      }

      const job = jobSnap.data() as JobRecord;
      const failure = buildJobFailureDetails(job.step, attempt, error, this.config);
      const materialRef = this.db.collection("materials").doc(job.materialId);
      const materialSnap = await tx.get(materialRef);

      tx.update(jobRef, {
        status: failure.isPermanentFailure ? "failed" : "queued",
        attempt: failure.nextAttempt,
        nextRunAt: failure.nextRunAt,
        updatedAt: now,
        lockedBy: "",
        lockedAt: now,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
      });

      if (!materialSnap.exists) {
        return;
      }

      const material = materialSnap.data() as MaterialRecord;
      tx.update(materialRef, {
        status: failure.isPermanentFailure ? "failed" : "queued",
        pipelineVersion: job.pipelineVersion,
        updatedAt: now,
        pipelineState: {
          currentStep: job.step,
          lastCompletedStep: material.pipelineState?.lastCompletedStep ?? null,
          status: failure.isPermanentFailure ? "failed" : "queued",
          updatedAt: now,
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
        },
      });
    });
  }

  private async yieldProcessingJobIfOwned(jobId: string, workerId: string): Promise<void> {
    const now = nowTs();
    const jobRef = this.db.collection("jobs").doc(jobId);

    await this.db.runTransaction(async (tx) => {
      const jobSnap = await tx.get(jobRef);
      if (!jobSnap.exists) {
        return;
      }

      const job = jobSnap.data() as JobRecord;
      if (job.status !== "processing" || job.lockedBy !== workerId) {
        return;
      }

      tx.update(jobRef, {
        status: "queued",
        nextRunAt: now,
        lockedBy: "",
        lockedAt: now,
        updatedAt: now,
        errorCode: "",
        errorMessage: "",
      });
    });
  }

  private async progressMaterialPipeline(jobId: string, job: JobRecord, workerId?: string): Promise<void> {
    const materialRef = this.db.collection("materials").doc(job.materialId);
    const jobRef = this.db.collection("jobs").doc(jobId);
    const now = nowTs();

    await this.pipeline.runStep({
      materialId: job.materialId,
      jobId,
      attempt: job.attempt + 1,
      pipelineVersion: job.pipelineVersion,
      step: job.step,
    });

    await this.db.runTransaction(async (tx) => {
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
      if (workerId && isFreshProcessingJob(latestJob, workerId, now, this.config.jobLockTimeoutMs)) {
        throw new Error("Job is locked by another worker.");
      }

      if (material.status === "ready" && material.pipelineVersion === latestJob.pipelineVersion) {
        const completed = buildPipelineProgressState(lastStep(), now);
        tx.update(materialRef, {
          status: completed.materialStatus,
          pipelineVersion: latestJob.pipelineVersion,
          updatedAt: now,
          pipelineState: completed.pipelineState,
        });
        tx.update(jobRef, {
          status: "done",
          step: lastStep(),
          updatedAt: now,
          lockedBy: "",
          lockedAt: now,
          errorCode: "",
          errorMessage: "",
        });
        return;
      }

      const progress = buildPipelineProgressState(latestJob.step, now);
      tx.update(materialRef, {
        status: progress.materialStatus,
        pipelineVersion: latestJob.pipelineVersion,
        updatedAt: now,
        pipelineState: progress.pipelineState,
      });

      tx.update(jobRef, {
        status: progress.jobStatus,
        step: progress.jobStep,
        updatedAt: now,
        lockedBy: progress.jobStatus === "done" ? "" : latestJob.lockedBy,
        lockedAt: now,
        errorCode: "",
        errorMessage: "",
      });
    });
  }

  async runSingleJob(jobId: string, workerId?: string): Promise<{ result: "done" | "processing" | "failed" }> {
    const jobRef = this.db.collection("jobs").doc(jobId);
    const snapshot = await jobRef.get();
    if (!snapshot.exists) {
      return { result: "failed" };
    }

    const job = snapshot.data() as JobRecord;
    if (job.status !== "processing") {
      return { result: "failed" };
    }
    if (workerId && isFreshProcessingJob(job, workerId, nowTs(), this.config.jobLockTimeoutMs)) {
      return { result: "processing" };
    }

    try {
      if (job.type === "material_pipeline") {
        await this.progressMaterialPipeline(jobId, job, workerId);
        const latest = await jobRef.get();
        const latestJob = latest.data() as JobRecord | undefined;
        if (!latestJob) {
          return { result: "failed" };
        }
        return { result: latestJob.status === "done" ? "done" : "processing" };
      }

      await this.markJobDone(jobId);
      return { result: "done" };
    } catch (error) {
      this.logger.error("job.run_failed", {
        jobId,
        materialId: job.materialId,
        attempt: job.attempt + 1,
        subtitleLanguage: "",
        subtitleKind: "",
        ytDlpExitCode: null,
        error,
      });
      await this.markJobQueuedForRetry(jobId, job.attempt, error);
      return { result: "failed" };
    }
  }

  async runJobToCompletion(
    jobId: string,
    workerId: string,
    maxIterations = MATERIAL_PIPELINE_STEPS.length + 2,
  ): Promise<{ result: "done" | "processing" | "failed" }> {
    const jobRef = this.db.collection("jobs").doc(jobId);
    const locked = await this.lockJobById(jobId, workerId);
    if (!locked) {
      const snapshot = await jobRef.get();
      if (!snapshot.exists) {
        return { result: "failed" };
      }

      const job = snapshot.data() as JobRecord;
      if (job.status === "done") {
        return { result: "done" };
      }
      if (job.status === "failed") {
        return { result: "failed" };
      }
      if (isFreshProcessingJob(job, workerId, nowTs(), this.config.jobLockTimeoutMs)) {
        return { result: "processing" };
      }
    }

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const snapshot = await jobRef.get();
      if (!snapshot.exists) {
        return { result: "failed" };
      }

      const job = snapshot.data() as JobRecord;
      if (job.status === "done") {
        return { result: "done" };
      }
      if (job.status === "failed") {
        return { result: "failed" };
      }
      if (job.status === "queued") {
        const relocked = await this.lockJobById(jobId, workerId);
        if (!relocked) {
          return { result: "processing" };
        }
        continue;
      }
      if (isFreshProcessingJob(job, workerId, nowTs(), this.config.jobLockTimeoutMs)) {
        return { result: "processing" };
      }

      const result = await this.runSingleJob(jobId, workerId);
      if (result.result === "done") {
        return { result: "done" };
      }
      if (result.result === "processing" && maxIterations <= 1) {
        await this.yieldProcessingJobIfOwned(jobId, workerId);
        return { result: "processing" };
      }
      if (result.result === "failed") {
        const latest = await jobRef.get();
        const latestJob = latest.data() as JobRecord | undefined;
        if (!latestJob) {
          return { result: "failed" };
        }
        return {
          result: latestJob.status === "failed" ? "failed" : "processing",
        };
      }
    }

    return { result: "processing" };
  }

  async dispatchAndProcessDueJobs(
    limitCount: number,
    workerId: string,
  ): Promise<{
    picked: number;
    processed: number;
    failed: number;
    reclaimedStaleLocks: number;
    results: Array<{ jobId: string; result: "done" | "processing" | "failed" }>;
  }> {
    const dispatchResult = await this.dispatchJobs(limitCount, workerId);
    const results = await Promise.all(
      dispatchResult.lockedJobIds.map(async (jobId) => {
        const result = await this.runJobToCompletion(jobId, workerId);
        return { jobId, result: result.result };
      }),
    );

    return {
      picked: dispatchResult.lockedJobIds.length,
      processed: results.filter((result) => result.result === "done").length,
      failed: results.filter((result) => result.result === "failed").length,
      reclaimedStaleLocks: dispatchResult.reclaimedStaleLocks,
      results,
    };
  }
}

export function createWorkerId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
