import type {
  Job as SharedJob,
  Material as SharedMaterial,
  MaterialPipelineState as SharedMaterialPipelineState,
  SavedExpression as SharedSavedExpression,
} from "@listening-app/material-pipeline-core";
import type { Timestamp } from "firebase/firestore";

export type {
  JobStatus,
  JobStep,
  JobType,
  MaterialStatus,
  Segment,
  SubtitleMetadata,
} from "@listening-app/material-pipeline-core";

export type MaterialPipelineState = SharedMaterialPipelineState<Timestamp>;

export type Material = SharedMaterial<Timestamp>;

export type SavedExpression = SharedSavedExpression<Timestamp>;

export type Job = SharedJob<Timestamp>;
