import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminDbMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => getAdminDbMock(),
}));

import { listMaterialExpressions } from "@/lib/server/materials";

describe("listMaterialExpressions", () => {
  beforeEach(() => {
    getAdminDbMock.mockReset();
  });

  it("limits results to 20 and replaces the generic fallback example with the source subtitle", async () => {
    const expressions = Array.from({ length: 22 }, (_, index) => ({
      id: `exp-${index + 1}`,
      data: () => ({
        expressionText: `expression ${index + 1}`,
        scoreFinal: 100 - index,
        axisScores: {
          utility: 80,
          portability: 80,
          naturalness: 80,
          c1_value: 80,
          context_robustness: 80,
        },
        meaningJa: "意味",
        reasonShort: "理由",
        scenarioExample:
          index === 0
            ? 'In a meeting, I used "expression 1" to explain my point clearly.'
            : `Natural example ${index + 1}`,
        flagsFinal: [],
        occurrences: [{ startMs: 0, endMs: 1000, segmentId: `seg-${index + 1}` }],
        createdAt: { toMillis: () => 1000 - index },
      }),
    }));

    getAdminDbMock.mockReturnValue({
      collection: () => ({
        doc: () => ({
          get: async () => ({
            exists: true,
            id: "mat-1",
            ref: {
              collection: (name: string) => ({
                get: async () => ({
                  docs:
                    name === "expressions"
                      ? expressions
                      : expressions.map((entry, index) => ({
                          id: `seg-${index + 1}`,
                          data: () => ({ text: `Subtitle example ${index + 1}` }),
                        })),
                }),
              }),
            },
          }),
        }),
      }),
    });

    const result = await listMaterialExpressions("mat-1");

    expect(result).toHaveLength(20);
    expect(result?.[0]?.scenarioExample).toBe("Subtitle example 1");
    expect(result?.[19]?.expressionId).toBe("exp-20");
  });
});
