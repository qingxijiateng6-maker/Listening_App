import type { SubtitleMetadata } from "./captions";
import type { JobStep, JobType, MaterialPipelineState } from "./pipeline";

export type QueueJobStatus = "queued" | "processing" | "done" | "failed";
export type QueueMaterialStatus = "queued" | "processing" | "ready" | "failed";

export type QueueJobRecord<TTimestamp = unknown> = {
  type: JobType;
  materialId: string;
  pipelineVersion: string;
  status: QueueJobStatus;
  step: JobStep;
  attempt: number;
  nextRunAt: TTimestamp;
  lockedBy?: string;
  lockedAt?: TTimestamp;
  errorCode?: string;
  errorMessage?: string;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
};

export type QueueMaterialRecord<TTimestamp = unknown> = {
  pipelineVersion: string;
  status: QueueMaterialStatus;
  pipelineState?: Omit<MaterialPipelineState<TTimestamp>, "status"> & {
    status: QueueMaterialStatus;
  };
  subtitleMetadata?: SubtitleMetadata;
  updatedAt: TTimestamp;
};

export type DispatchResult = {
  reclaimedStaleLocks: number;
  lockedJobIds: string[];
};

export type RunJobResult = {
  result: "done" | "processing" | "failed";
};

export type RunJobToCompletion = (
  jobId: string,
  workerId: string,
  maxIterations?: number,
) => Promise<RunJobResult>;

export type MaterialPipelineQueue = {
  dispatchJobs(limitCount: number, workerId: string): Promise<DispatchResult>;
  runJobToCompletion: RunJobToCompletion;
};
