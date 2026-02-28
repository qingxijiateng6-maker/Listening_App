import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import {
  buildJobFailureDetails,
  buildPipelineProgressState,
  computeBackoffSeconds,
  isLockStale,
} from "@/lib/jobs/queue";

describe("queue retry policy", () => {
  it("uses exponential backoff", () => {
    expect(computeBackoffSeconds(1)).toBe(30);
    expect(computeBackoffSeconds(2)).toBe(60);
    expect(computeBackoffSeconds(3)).toBe(120);
  });
});

describe("job lock policy", () => {
  it("marks stale lock when lockedAt is too old", () => {
    const now = Timestamp.fromMillis(1_000_000);
    const old = Timestamp.fromMillis(1_000_000 - 11 * 60 * 1000);
    expect(isLockStale(old, now)).toBe(true);
  });

  it("keeps lock valid when within ttl", () => {
    const now = Timestamp.fromMillis(1_000_000);
    const recent = Timestamp.fromMillis(1_000_000 - 2 * 60 * 1000);
    expect(isLockStale(recent, now)).toBe(false);
  });
});

describe("material pipeline progress state", () => {
  it("keeps material status and pipelineState aligned for intermediate steps", () => {
    const now = Timestamp.fromMillis(2_000_000);
    const progress = buildPipelineProgressState("meta", now);

    expect(progress.materialStatus).toBe("processing");
    expect(progress.jobStatus).toBe("processing");
    expect(progress.jobStep).toBe("captions");
    expect(progress.pipelineState).toMatchObject({
      currentStep: "captions",
      lastCompletedStep: "meta",
      status: "processing",
      updatedAt: now,
      errorCode: "",
      errorMessage: "",
    });
  });

  it("marks persist as the ready terminal state", () => {
    const now = Timestamp.fromMillis(3_000_000);
    const progress = buildPipelineProgressState("persist", now);

    expect(progress.materialStatus).toBe("ready");
    expect(progress.jobStatus).toBe("done");
    expect(progress.jobStep).toBe("persist");
    expect(progress.pipelineState).toMatchObject({
      currentStep: "persist",
      lastCompletedStep: "persist",
      status: "ready",
      updatedAt: now,
      errorCode: "",
      errorMessage: "",
    });
  });
});

describe("material pipeline failure details", () => {
  it("uses a step-specific retry error for transient failures", () => {
    const details = buildJobFailureDetails("score", 0, new Error("scoring exploded"));

    expect(details.isPermanentFailure).toBe(false);
    expect(details.nextAttempt).toBe(1);
    expect(details.errorCode).toBe("material_pipeline_score_retrying");
    expect(details.errorMessage).toContain('step "score" retrying on attempt 1/6: scoring exploded');
  });

  it("marks the final attempt as a permanent step failure", () => {
    const details = buildJobFailureDetails("persist", 5, new Error("write denied"));

    expect(details.isPermanentFailure).toBe(true);
    expect(details.nextAttempt).toBe(6);
    expect(details.errorCode).toBe("material_pipeline_persist_failed");
    expect(details.errorMessage).toContain('step "persist" failed on attempt 6/6: write denied');
  });
});
