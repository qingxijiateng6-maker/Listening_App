import type { Timestamp } from "firebase/firestore";

export type MaterialStatus = "queued" | "processing" | "ready" | "failed" | "cancelled";
export type JobType = "material_pipeline";
export type JobStatus = "queued" | "processing" | "done" | "failed" | "cancelled";
export type JobStep = "meta" | "captions" | "format";

export type MaterialPipelineState = {
  currentStep: JobStep;
  lastCompletedStep: JobStep | null;
  status: MaterialStatus;
  updatedAt: Timestamp;
  currentStepStartedAt?: Timestamp;
  requiresContinuationConfirmation?: boolean;
  continuationConfirmedAt?: Timestamp | null;
  errorCode?: string;
  errorMessage?: string;
};

export type Material = {
  youtubeUrl: string;
  youtubeId: string;
  title: string;
  channel: string;
  durationSec: number;
  status: MaterialStatus;
  pipelineVersion: string;
  pipelineState?: MaterialPipelineState;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Segment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type SavedExpression = {
  expression: string;
  meaning: string;
  exampleSentence: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Job = {
  type: JobType;
  materialId: string;
  pipelineVersion: string;
  status: JobStatus;
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
