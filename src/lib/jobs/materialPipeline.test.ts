import { describe, expect, it } from "vitest";
import {
  EXPRESSION_THRESHOLD,
  decideAcceptance,
  runExpressionPipelineInMemory,
} from "@/lib/jobs/materialPipeline";

describe("threshold decision", () => {
  it("accepts at threshold and above", () => {
    expect(decideAcceptance(EXPRESSION_THRESHOLD, [])).toBe(true);
    expect(decideAcceptance(EXPRESSION_THRESHOLD + 10, ["single_word"])).toBe(true);
  });

  it("rejects below threshold or unsafe", () => {
    expect(decideAcceptance(EXPRESSION_THRESHOLD - 1, [])).toBe(false);
    expect(decideAcceptance(99, ["unsafe_or_inappropriate"])).toBe(false);
  });
});

describe("pipeline failure scenarios", () => {
  it("handles no subtitles (empty segments) without crash", () => {
    const result = runExpressionPipelineInMemory([]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it("propagates scenario example generation failure", () => {
    expect(() =>
      runExpressionPipelineInMemory(
        [
          {
            id: "s1",
            startMs: 0,
            endMs: 2000,
            text: "we should take ownership and move forward quickly",
          },
          {
            id: "s2",
            startMs: 2100,
            endMs: 4200,
            text: "if we take ownership we can move forward as a team",
          },
        ],
        {
          generateScenarioExample: () => {
            throw new Error("LLM failed");
          },
        },
      ),
    ).toThrow("LLM failed");
  });
});
