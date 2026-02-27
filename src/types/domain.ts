import type { Timestamp } from "firebase/firestore";

export type MaterialStatus = "queued" | "processing" | "ready" | "failed";
export type UserExpressionStatus = "saved" | "ignored" | "mastered";
export type JobType = "material_pipeline" | "glossary_generate";
export type JobStatus = "queued" | "processing" | "done" | "failed";
export type JobStep =
  | "meta"
  | "captions"
  | "asr"
  | "format"
  | "extract"
  | "filter"
  | "score"
  | "reeval"
  | "examples"
  | "persist";

export type AxisScores = {
  utility: number;
  portability: number;
  naturalness: number;
  c1_value: number;
  context_robustness: number;
};

export type ExpressionOccurrence = {
  startMs: number;
  endMs: number;
  segmentId: string;
};

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

export type Expression = {
  expressionText: string;
  scoreFinal: number;
  axisScores: AxisScores;
  meaningJa: string;
  reasonShort: string;
  scenarioExample: string;
  flagsFinal: string[];
  occurrences: ExpressionOccurrence[];
  createdAt: Timestamp;
};

export type Glossary = {
  surfaceText: string;
  meaningJa: string;
  createdAt: Timestamp;
};

export type UserExpression = {
  status: UserExpressionStatus;
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
