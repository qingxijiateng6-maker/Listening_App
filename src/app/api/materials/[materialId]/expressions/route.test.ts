import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/materials/[materialId]/expressions/route";

const listMaterialExpressionsMock = vi.fn();

vi.mock("@/lib/server/materials", () => ({
  listMaterialExpressions: (...args: unknown[]) => listMaterialExpressionsMock(...args),
}));

describe("GET /api/materials/[materialId]/expressions", () => {
  beforeEach(() => {
    listMaterialExpressionsMock.mockReset();
  });

  it("returns 404 when the material does not exist", async () => {
    listMaterialExpressionsMock.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/api/materials/mat-1/expressions"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(listMaterialExpressionsMock).toHaveBeenCalledWith("mat-1");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Material not found" });
  });

  it("returns the material expressions", async () => {
    listMaterialExpressionsMock.mockResolvedValueOnce([
      {
        expressionId: "exp-1",
        expressionText: "align on priorities",
        scoreFinal: 82,
        axisScores: {
          utility: 85,
          portability: 76,
          naturalness: 74,
          c1_value: 79,
          context_robustness: 81,
        },
        meaningJa: "優先順位をそろえる",
        reasonShort: "会議で使いやすい",
        scenarioExample: "We need to align on priorities before launch.",
        flagsFinal: [],
        occurrences: [
          { startMs: 1000, endMs: 2000, segmentId: "seg-1" },
        ],
        createdAt: { seconds: 30, nanoseconds: 0, toMillis: () => 30000 },
      },
    ]);

    const response = await GET(new Request("http://localhost/api/materials/mat-1/expressions"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      expressions: [
        {
          expressionId: "exp-1",
          expressionText: "align on priorities",
          scoreFinal: 82,
          axisScores: {
            utility: 85,
            portability: 76,
            naturalness: 74,
            c1_value: 79,
            context_robustness: 81,
          },
          meaningJa: "優先順位をそろえる",
          reasonShort: "会議で使いやすい",
          scenarioExample: "We need to align on priorities before launch.",
          flagsFinal: [],
          occurrences: [
            { startMs: 1000, endMs: 2000, segmentId: "seg-1" },
          ],
          createdAt: { seconds: 30, nanoseconds: 0 },
        },
      ],
    });
  });
});
