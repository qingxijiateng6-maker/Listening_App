import { describe, expect, it } from "vitest";
import { buildMaterialPipelineJobId } from "@/lib/jobs/idempotency";

describe("material pipeline idempotency key", () => {
  it("returns same id for same material and pipeline version", () => {
    const a = buildMaterialPipelineJobId("mat1", "v1");
    const b = buildMaterialPipelineJobId("mat1", "v1");
    expect(a).toBe(b);
  });

  it("returns different id when material or version differs", () => {
    const a = buildMaterialPipelineJobId("mat1", "v1");
    const b = buildMaterialPipelineJobId("mat2", "v1");
    const c = buildMaterialPipelineJobId("mat1", "v2");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
