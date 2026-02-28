import { afterEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();

vi.mock("@/lib/server/llm/client", () => ({
  getDefaultServerLlmClient: () => ({
    generateText: (...args: Parameters<typeof generateTextMock>) => generateTextMock(...args),
  }),
}));

vi.mock("@/lib/server/llm/openaiProvider", () => ({
  isOpenAIConfigured: () => true,
}));

import {
  generateScenarioExampleWithOpenAI,
  reevaluateExpressionWithOpenAI,
} from "@/lib/llm/openai";

describe("llm openai helpers", () => {
  afterEach(() => {
    generateTextMock.mockReset();
  });

  it("parses structured reeval json", async () => {
    generateTextMock.mockResolvedValue(`
      {
        "decision": "accept",
        "reasonShort": "汎用性が高く自然です",
        "meaningJa": "主体的に責任を引き受けること"
      }
    `);

    await expect(
      reevaluateExpressionWithOpenAI({
        expressionText: "take ownership",
        scoreFinal: 88,
        flagsFinal: [],
        axisScores: {
          utility: 90,
          portability: 88,
          naturalness: 84,
          c1_value: 83,
          context_robustness: 86,
        },
        occurrenceCount: 2,
      }),
    ).resolves.toEqual({
      decision: "accept",
      reasonShort: "汎用性が高く自然です",
      meaningJa: "主体的に責任を引き受けること",
    });
  });

  it("rejects invalid reeval json", async () => {
    generateTextMock.mockResolvedValue("not json");

    await expect(
      reevaluateExpressionWithOpenAI({
        expressionText: "take ownership",
        scoreFinal: 88,
        flagsFinal: [],
        axisScores: {
          utility: 90,
          portability: 88,
          naturalness: 84,
          c1_value: 83,
          context_robustness: 86,
        },
        occurrenceCount: 2,
      }),
    ).rejects.toMatchObject({
      name: "ServerLlmError",
      code: "invalid_response",
    });
  });

  it("trims generated examples", async () => {
    generateTextMock.mockResolvedValue('  We need to take ownership before the launch.  ');

    await expect(generateScenarioExampleWithOpenAI("take ownership")).resolves.toBe(
      "We need to take ownership before the launch.",
    );
  });
});
