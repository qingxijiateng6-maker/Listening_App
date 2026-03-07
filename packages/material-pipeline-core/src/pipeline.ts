import type { SubtitleMetadata } from "./captions";

export type MaterialStatus = "queued" | "processing" | "ready" | "failed" | "cancelled";
export type JobType = "material_pipeline";
export type JobStatus = "queued" | "processing" | "done" | "failed" | "cancelled";
export type JobStep = "meta" | "captions" | "format";

export type MaterialPipelineState<TTimestamp = unknown> = {
  currentStep: JobStep;
  lastCompletedStep: JobStep | null;
  status: MaterialStatus;
  updatedAt: TTimestamp;
  currentStepStartedAt?: TTimestamp;
  requiresContinuationConfirmation?: boolean;
  continuationConfirmedAt?: TTimestamp | null;
  errorCode?: string;
  errorMessage?: string;
};

export type Material<TTimestamp = unknown> = {
  youtubeUrl: string;
  youtubeId: string;
  title: string;
  channel: string;
  durationSec: number;
  status: MaterialStatus;
  pipelineVersion: string;
  pipelineState?: MaterialPipelineState<TTimestamp>;
  // Keep top-level material fields canonical while allowing additive subtitle provenance later.
  subtitleMetadata?: SubtitleMetadata;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
};

export type Segment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type SavedExpression<TTimestamp = unknown> = {
  expression: string;
  meaning: string;
  exampleSentence: string;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
};

export type Job<TTimestamp = unknown> = {
  type: JobType;
  materialId: string;
  pipelineVersion: string;
  status: JobStatus;
  step: JobStep;
  attempt: number;
  nextRunAt: TTimestamp;
  lockedBy: string;
  lockedAt: TTimestamp;
  errorCode: string;
  errorMessage: string;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
};

export type MaterialPipelineStepInput = {
  materialId: string;
  pipelineVersion: string;
  step: JobStep;
};

export type RunMaterialPipelineStep = (input: MaterialPipelineStepInput) => Promise<void>;
