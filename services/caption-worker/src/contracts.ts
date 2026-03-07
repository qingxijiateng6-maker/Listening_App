import type { Timestamp } from "firebase-admin/firestore";

export type MaterialStatus = "queued" | "processing" | "ready" | "failed" | "cancelled";
export type JobType = "material_pipeline";
export type JobStatus = "queued" | "processing" | "done" | "failed" | "cancelled";
export type JobStep = "meta" | "captions" | "format";
export type SubtitleKind = "manual" | "auto";

export type MaterialPipelineState = {
  currentStep: JobStep;
  lastCompletedStep: JobStep | null;
  status: MaterialStatus;
  updatedAt: Timestamp;
  errorCode?: string;
  errorMessage?: string;
};

export type MaterialRecord = {
  ownerUid?: string;
  youtubeUrl: string;
  youtubeId: string;
  title?: string;
  channel?: string;
  durationSec?: number;
  status?: MaterialStatus;
  pipelineVersion?: string;
  pipelineState?: MaterialPipelineState;
  subtitle?: {
    language: string;
    kind: SubtitleKind;
    name?: string;
    source: "yt_dlp";
    videoLanguage?: string;
  };
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type JobRecord = {
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

export type DispatchJobsRequest = {
  limit?: number;
};

export type DispatchJobsResponse = {
  picked: number;
  processed: number;
  failed: number;
  reclaimedStaleLocks: number;
  results: Array<{
    jobId: string;
    result: "done" | "processing" | "failed";
  }>;
};
