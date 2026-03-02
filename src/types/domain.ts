import type { Timestamp } from "firebase/firestore";

export type MaterialStatus = "queued" | "processing" | "ready" | "failed";
export type JobType = "material_pipeline";
export type JobStatus = "queued" | "processing" | "done" | "failed";
export type JobStep = "meta" | "captions" | "format";

export type Material = {
  youtubeUrl: string;
  youtubeId: string;
  title: string;
  channel: string;
  durationSec: number;
  status: MaterialStatus;
  pipelineVersion: string;
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
