import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

type StoredValue = Record<string, unknown>;

class MockTransaction {
  constructor(private readonly docs: Map<string, StoredValue>) {}

  async get(ref: { path: string }) {
    const value = this.docs.get(ref.path);
    return {
      exists: value !== undefined,
      data: () => (value ? structuredClone(value) : undefined),
    };
  }

  create(ref: { path: string }, value: StoredValue) {
    this.docs.set(ref.path, structuredClone(value));
  }

  update(ref: { path: string }, value: StoredValue) {
    const previous = this.docs.get(ref.path) ?? {};
    this.docs.set(ref.path, { ...structuredClone(previous), ...structuredClone(value) });
  }
}

class MockDb {
  readonly docs = new Map<string, StoredValue>();

  collection(name: string) {
    return {
      doc: (id: string) => ({
        path: `${name}/${id}`,
      }),
    };
  }

  async runTransaction(callback: (tx: MockTransaction) => Promise<void>) {
    await callback(new MockTransaction(this.docs));
  }
}

const getAdminDbMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => getAdminDbMock(),
}));

import { enqueueMaterialPipelineJob } from "@/lib/jobs/queue";

describe("enqueueMaterialPipelineJob", () => {
  beforeEach(() => {
    getAdminDbMock.mockReset();
  });

  it("creates a queued job and initializes the material pipeline state", async () => {
    const db = new MockDb();
    db.docs.set("materials/mat-1", {
      status: "processing",
      pipelineVersion: "v1",
      updatedAt: Timestamp.fromMillis(1),
    });
    getAdminDbMock.mockReturnValueOnce(db);

    const jobId = await enqueueMaterialPipelineJob("mat-1");

    expect(jobId).toBe("material_pipeline:mat-1:v2");
    expect(db.docs.get("jobs/material_pipeline:mat-1:v2")).toMatchObject({
      type: "material_pipeline",
      materialId: "mat-1",
      pipelineVersion: "v2",
      status: "queued",
      step: "meta",
      attempt: 0,
      lockedBy: "",
      errorCode: "",
      errorMessage: "",
    });
    expect(db.docs.get("materials/mat-1")).toMatchObject({
      status: "queued",
      pipelineVersion: "v2",
      pipelineState: {
        currentStep: "meta",
        lastCompletedStep: null,
        status: "queued",
        errorCode: "",
        errorMessage: "",
      },
    });
  });

  it("keeps an existing job untouched", async () => {
    const db = new MockDb();
    db.docs.set("jobs/material_pipeline:mat-1:v2", {
      type: "material_pipeline",
      materialId: "mat-1",
      pipelineVersion: "v2",
      status: "queued",
    });
    getAdminDbMock.mockReturnValueOnce(db);

    await enqueueMaterialPipelineJob("mat-1");

    expect(db.docs.size).toBe(1);
  });

  it("skips job creation for an already-ready material on the current pipeline version", async () => {
    const db = new MockDb();
    db.docs.set("materials/mat-1", {
      status: "ready",
      pipelineVersion: "v2",
      updatedAt: Timestamp.fromMillis(1),
    });
    getAdminDbMock.mockReturnValueOnce(db);

    await enqueueMaterialPipelineJob("mat-1");

    expect(db.docs.has("jobs/material_pipeline:mat-1:v2")).toBe(false);
    expect(db.docs.get("materials/mat-1")).toMatchObject({
      status: "ready",
      pipelineVersion: "v2",
    });
  });
});
