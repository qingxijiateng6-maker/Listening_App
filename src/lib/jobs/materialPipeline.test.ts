import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { ServerLlmError } from "@/lib/server/llm/errors";

const getAdminDbMock = vi.fn();
const fetchCaptionsMock = vi.fn();
const generateScenarioExampleWithOpenAIMock = vi.fn();
const reevaluateExpressionWithOpenAIMock = vi.fn();
const isOpenAIEnabledMock = vi.fn(() => false);
const fetchMock = vi.fn();

let timestampCounter = 0;

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    now: () => ({ marker: `ts-${++timestampCounter}` }),
  },
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => getAdminDbMock(),
}));

vi.mock("@/lib/jobs/materialPipelineCaptions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/jobs/materialPipelineCaptions")>(
    "@/lib/jobs/materialPipelineCaptions",
  );

  return {
    ...actual,
    getMaterialPipelineCaptionProvider: () => ({
      fetchCaptions: (...args: Parameters<typeof fetchCaptionsMock>) => fetchCaptionsMock(...args),
    }),
  };
});

vi.mock("@/lib/llm/openai", () => ({
  generateScenarioExampleWithOpenAI: (...args: Parameters<typeof generateScenarioExampleWithOpenAIMock>) =>
    generateScenarioExampleWithOpenAIMock(...args),
  reevaluateExpressionWithOpenAI: (...args: Parameters<typeof reevaluateExpressionWithOpenAIMock>) =>
    reevaluateExpressionWithOpenAIMock(...args),
  isOpenAIEnabled: () => isOpenAIEnabledMock(),
}));

import {
  EXPRESSION_THRESHOLD,
  decideAcceptance,
  runExpressionPipelineInMemory,
  runMaterialPipelineStep,
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
  beforeEach(() => {
    timestampCounter = 0;
    getAdminDbMock.mockReset();
    fetchCaptionsMock.mockReset();
    generateScenarioExampleWithOpenAIMock.mockReset();
    reevaluateExpressionWithOpenAIMock.mockReset();
    isOpenAIEnabledMock.mockReset();
    isOpenAIEnabledMock.mockReturnValue(false);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("handles no subtitles (empty segments) without crash", () => {
    const result = runExpressionPipelineInMemory([]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it("prioritizes idioms and advanced words over generic fragments", () => {
    const result = runExpressionPipelineInMemory([
      {
        id: "s1",
        startMs: 0,
        endMs: 2000,
        text: "When you face the music, do not freak out.",
      },
      {
        id: "s2",
        startMs: 2100,
        endMs: 4200,
        text: "We should mitigate the risk instead of accepting a humdrum plan.",
      },
      {
        id: "s3",
        startMs: 4300,
        endMs: 6500,
        text: "It was more than enough in the skiing industry.",
      },
    ]);

    const acceptedTexts = result.accepted.map((candidate) => candidate.expressionText);
    const rejectedTexts = result.rejected.map((candidate) => candidate.expressionText);

    expect(acceptedTexts).toContain("face the music");
    expect(acceptedTexts).toContain("freak out");
    expect(acceptedTexts).toContain("mitigate");
    expect(acceptedTexts).toContain("humdrum");
    expect(acceptedTexts).not.toContain("more than");
    expect(acceptedTexts).not.toContain("it was");
    expect(acceptedTexts).not.toContain("in the skiing industry");
    expect(rejectedTexts).not.toContain("more than");
    expect(rejectedTexts).not.toContain("it was");
    expect(rejectedTexts).not.toContain("in the skiing industry");
    expect(result.accepted.find((candidate) => candidate.expressionText === "face the music")?.meaningJa).toBe(
      "厳しい現実を受け入れる",
    );
    expect(result.accepted.find((candidate) => candidate.expressionText === "mitigate")?.meaningJa).toBe(
      "和らげる",
    );
  });

  it("keeps only the top 20 accepted expressions", () => {
    const advancedWords = [
      "mitigate",
      "allocate",
      "articulate",
      "cultivate",
      "differentiate",
      "facilitate",
      "formulate",
      "integrate",
      "negotiate",
      "regulate",
      "correlation",
      "implication",
      "coordination",
      "justification",
      "optimization",
      "transformation",
      "sustainability",
      "productivity",
      "credibility",
      "flexibility",
      "resilience",
      "leadership",
      "awareness",
      "ownership",
    ];
    const segments = advancedWords.map((word, index) => ({
      id: `s${index + 1}`,
      startMs: index * 1000,
      endMs: index * 1000 + 900,
      text: `We should ${word} the plan immediately.`,
    }));

    const result = runExpressionPipelineInMemory(segments);

    expect(result.accepted).toHaveLength(20);
    expect(result.accepted[0]?.scoreFinal).toBeGreaterThanOrEqual(result.accepted[19]?.scoreFinal ?? 0);
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

  it("keeps persist idempotent by preserving existing createdAt for accepted expressions", async () => {
    const expressionDocId = createHash("sha1").update("take ownership").digest("hex");
    const pipelineState: {
      candidates: unknown[];
      accepted: Array<Record<string, unknown>>;
      updatedAt: { marker: string };
      persistedCount?: number;
    } = {
      candidates: [],
      accepted: [
        {
          expressionText: "take ownership",
          occurrences: [{ startMs: 0, endMs: 1000, segmentId: "seg-1" }],
          flagsFinal: [],
          axisScores: {
            utility: 90,
            portability: 88,
            naturalness: 84,
            c1_value: 83,
            context_robustness: 86,
          },
          scoreFinal: EXPRESSION_THRESHOLD + 5,
          decision: "accept" as const,
          meaningJa: "主体的に責任を持つ",
          reasonShort: "5軸評価=80, 出現=1",
          scenarioExample: "In a meeting, I used \"take ownership\" to explain my point clearly.",
        },
      ],
      updatedAt: { marker: "state-ts" },
    };

    const expressionDocs = new Map<string, Record<string, unknown>>();
    const stateDocRef = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => pipelineState,
      })),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(pipelineState, value);
      }),
    };

    const buildExpressionDocRef = (docId: string) => ({
      id: docId,
      get: vi.fn(async () => ({
        id: docId,
        exists: expressionDocs.has(docId),
        data: () => expressionDocs.get(docId),
      })),
    });

    const db = {
      batch: () => {
        const writes: Array<{
          ref: { id: string };
          value: Record<string, unknown>;
          options?: { merge?: boolean };
        }> = [];
        return {
          set: (ref: { id: string }, value: Record<string, unknown>, options?: { merge?: boolean }) => {
            writes.push({ ref, value, options });
          },
          delete: (ref: { id: string }) => {
            writes.push({ ref, value: {}, options: { merge: false, delete: true } as { merge?: boolean } });
          },
          commit: async () => {
            writes.forEach(({ ref, value, options }) => {
              if ((options as { delete?: boolean } | undefined)?.delete) {
                expressionDocs.delete(ref.id);
                return;
              }
              const current = expressionDocs.get(ref.id) ?? {};
              expressionDocs.set(ref.id, options?.merge ? { ...current, ...value } : value);
            });
          },
        };
      },
      collection: (name: string) => {
        expect(name).toBe("materials");
        return {
          doc: (materialId: string) => ({
            collection: (childName: string) => {
              if (childName === "_pipeline") {
                return {
                  doc: (docId: string) => {
                    expect(materialId).toBe("mat-1");
                    expect(docId).toBe("state:v1");
                    return stateDocRef;
                  },
                };
              }

              expect(childName).toBe("expressions");
              return {
                doc: (docId: string) => buildExpressionDocRef(docId),
                get: vi.fn(async () => ({
                  docs: Array.from(expressionDocs.entries()).map(([id, value]) => ({
                    id,
                    ref: { id },
                    data: () => value,
                  })),
                })),
              };
            },
          }),
        };
      },
    };

    getAdminDbMock.mockReturnValue(db);

    await runMaterialPipelineStep({
      materialId: "mat-1",
      pipelineVersion: "v1",
      step: "persist",
    });

    const firstPersist = expressionDocs.get(expressionDocId);
    expect(firstPersist?.createdAt).toEqual({ marker: "ts-1" });

    await runMaterialPipelineStep({
      materialId: "mat-1",
      pipelineVersion: "v1",
      step: "persist",
    });

    const secondPersist = expressionDocs.get(expressionDocId);
    expect(expressionDocs.size).toBe(1);
    expect(secondPersist?.createdAt).toEqual({ marker: "ts-1" });
    expect(pipelineState.persistedCount).toBe(1);
  });

  it("stores material meta and fails fast when captions are unavailable", async () => {
    const pipelineState: {
      meta?: {
        youtubeId: string;
        youtubeUrl: string;
        title: string;
        channel: string;
        durationSec: number;
      };
      captions?: Record<string, unknown>;
      formattedSegmentCount?: number;
      candidates: unknown[];
      accepted: unknown[];
      updatedAt: { marker: string };
    } = {
      candidates: [],
      accepted: [],
      updatedAt: { marker: "state-ts" },
    };
    const segments = new Map<string, Record<string, unknown>>([
      ["old-seg", { startMs: 1, endMs: 2, text: "stale" }],
    ]);

    const materialDocRef = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => ({
          youtubeId: "dQw4w9WgXcQ",
          youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Video title",
          channel: "Channel name",
          durationSec: 321,
        }),
      })),
      set: vi.fn(async () => undefined),
      collection: (childName: string) => {
        if (childName === "_pipeline") {
          return {
            doc: () => ({
              get: vi.fn(async () => ({
                exists: true,
                data: () => pipelineState,
              })),
              set: vi.fn(async (value: Record<string, unknown>) => {
                Object.assign(pipelineState, value);
              }),
            }),
          };
        }

        expect(childName).toBe("segments");
        return {
          get: vi.fn(async () => ({
            docs: Array.from(segments.entries()).map(([id, value]) => ({
              id,
              ref: { id },
              data: () => value,
            })),
          })),
          doc: (docId: string) => ({ id: docId }),
        };
      },
    };

    getAdminDbMock.mockReturnValue({
      batch: () => {
        const ops: Array<{ type: "delete" | "set"; ref: { id: string }; value?: Record<string, unknown> }> = [];
        return {
          delete: (ref: { id: string }) => {
            ops.push({ type: "delete", ref });
          },
          set: (ref: { id: string }, value: Record<string, unknown>) => {
            ops.push({ type: "set", ref, value });
          },
          commit: async () => {
            ops.forEach((op) => {
              if (op.type === "delete") {
                segments.delete(op.ref.id);
                return;
              }
              segments.set(op.ref.id, op.value ?? {});
            });
          },
        };
      },
      collection: (name: string) => {
        expect(name).toBe("materials");
        return {
          doc: (materialId: string) => {
            expect(materialId).toBe("mat-1");
            return materialDocRef;
          },
        };
      },
    });

    fetchCaptionsMock.mockResolvedValue({
      status: "unavailable",
      source: "youtube_captions",
      reason: "captions_not_found",
      message: "No published captions were found for this video.",
    });

    await runMaterialPipelineStep({
      materialId: "mat-1",
      pipelineVersion: "v1",
      step: "meta",
    });
    await expect(
      runMaterialPipelineStep({
        materialId: "mat-1",
        pipelineVersion: "v1",
        step: "captions",
      }),
    ).rejects.toThrow("No published captions were found for this video.");

    expect(pipelineState.meta).toEqual({
      youtubeId: "dQw4w9WgXcQ",
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Video title",
      channel: "Channel name",
      durationSec: 321,
    });
    expect(fetchCaptionsMock).toHaveBeenCalledWith({
      materialId: "mat-1",
      youtubeId: "dQw4w9WgXcQ",
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(pipelineState.captions).toBeUndefined();
    expect(pipelineState.formattedSegmentCount).toBeUndefined();
    expect(segments.size).toBe(1);
  });

  it("formats fetched captions into deterministic segments before extract reads them", async () => {
    const pipelineState: {
      meta?: {
        youtubeId: string;
        youtubeUrl: string;
        title: string;
        channel: string;
        durationSec: number;
      };
      captions?: Record<string, unknown>;
      formattedSegmentCount?: number;
      candidates: unknown[];
      accepted: unknown[];
      updatedAt: { marker: string };
    } = {
      meta: {
        youtubeId: "dQw4w9WgXcQ",
        youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title: "",
        channel: "",
        durationSec: 0,
      },
      candidates: [],
      accepted: [],
      updatedAt: { marker: "state-ts" },
    };
    const segments = new Map<string, Record<string, unknown>>();

    const stateDocRef = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => pipelineState,
      })),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(pipelineState, value);
      }),
    };

    getAdminDbMock.mockReturnValue({
      batch: () => {
        const ops: Array<{ type: "delete" | "set"; ref: { id: string }; value?: Record<string, unknown> }> = [];
        return {
          delete: (ref: { id: string }) => {
            ops.push({ type: "delete", ref });
          },
          set: (ref: { id: string }, value: Record<string, unknown>) => {
            ops.push({ type: "set", ref, value });
          },
          commit: async () => {
            ops.forEach((op) => {
              if (op.type === "delete") {
                segments.delete(op.ref.id);
                return;
              }
              segments.set(op.ref.id, op.value ?? {});
            });
          },
        };
      },
      collection: (name: string) => {
        expect(name).toBe("materials");
        return {
          doc: () => ({
            get: vi.fn(async () => ({
              exists: true,
              data: () => ({
                youtubeId: "dQw4w9WgXcQ",
                youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              }),
            })),
            set: vi.fn(async () => undefined),
            collection: (childName: string) => {
              if (childName === "_pipeline") {
                return { doc: () => stateDocRef };
              }
              return {
                get: vi.fn(async () => ({
                  docs: Array.from(segments.entries()).map(([id, value]) => ({
                    id,
                    ref: { id },
                    data: () => value,
                  })),
                })),
                doc: (docId: string) => ({ id: docId }),
              };
            },
          }),
        };
      },
    });

    fetchCaptionsMock.mockResolvedValue({
      status: "fetched",
      source: "youtube_captions",
      cues: [
        { startMs: 2000, endMs: 3200, text: "  Take   ownership " },
        { startMs: 0, endMs: 1500, text: "Move forward" },
      ],
      metadata: {
        title: "Video title",
        channel: "Channel name",
        durationSec: 321,
      },
    });

    await runMaterialPipelineStep({
      materialId: "mat-1",
      pipelineVersion: "v1",
      step: "captions",
    });
    await runMaterialPipelineStep({
      materialId: "mat-1",
      pipelineVersion: "v1",
      step: "format",
    });

    expect(pipelineState.formattedSegmentCount).toBe(2);
    expect(Array.from(segments.entries())).toEqual([
      ["seg-0001", { startMs: 0, endMs: 1500, text: "Move forward" }],
      ["seg-0002", { startMs: 2000, endMs: 3200, text: "Take ownership" }],
    ]);
  });

  it("stores structured reeval data from openai", async () => {
    isOpenAIEnabledMock.mockReturnValue(true);
    reevaluateExpressionWithOpenAIMock.mockResolvedValue({
      decision: "accept",
      reasonShort: "会議でも汎用的で自然",
      meaningJa: "主体的に責任を持つこと",
    });

    const pipelineState: {
      candidates: Array<Record<string, unknown>>;
      accepted: Array<Record<string, unknown>>;
      updatedAt: { marker: string };
    } = {
      candidates: [
        {
          expressionText: "take ownership",
          occurrences: [{ startMs: 0, endMs: 1000, segmentId: "seg-1" }],
          flagsFinal: [],
          axisScores: {
            utility: 90,
            portability: 88,
            naturalness: 84,
            c1_value: 83,
            context_robustness: 86,
          },
          scoreFinal: 68,
          decision: "pending",
          meaningJa: "",
          reasonShort: "",
          scenarioExample: "",
        },
      ],
      accepted: [],
      updatedAt: { marker: "state-ts" },
    };

    const stateDocRef = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => pipelineState,
      })),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(pipelineState, value);
      }),
    };

    getAdminDbMock.mockReturnValue({
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => stateDocRef,
          }),
        }),
      }),
    });

    await runMaterialPipelineStep({
      materialId: "mat-1",
      pipelineVersion: "v1",
      step: "reeval",
    });

    expect(reevaluateExpressionWithOpenAIMock).toHaveBeenCalledWith({
      expressionText: "take ownership",
      contextText: undefined,
      scoreFinal: 68,
      flagsFinal: [],
      axisScores: {
        utility: 90,
        portability: 88,
        naturalness: 84,
        c1_value: 83,
        context_robustness: 86,
      },
      occurrenceCount: 1,
    });
    expect(pipelineState.candidates[0]).toMatchObject({
      decision: "accept",
      reeval: {
        source: "openai",
        decision: "accept",
        reasonShort: "会議でも汎用的で自然",
        meaningJa: "主体的に責任を持つこと",
      },
    });
    expect(pipelineState.accepted).toHaveLength(1);
  });

  it("falls back gracefully when reeval returns invalid json or times out", async () => {
    isOpenAIEnabledMock.mockReturnValue(true);
    reevaluateExpressionWithOpenAIMock.mockRejectedValue(
      new ServerLlmError("OpenAI returned invalid JSON.", "invalid_response"),
    );

    const pipelineState: {
      candidates: Array<Record<string, unknown>>;
      accepted: Array<Record<string, unknown>>;
      updatedAt: { marker: string };
    } = {
      candidates: [
        {
          expressionText: "take ownership",
          occurrences: [{ startMs: 0, endMs: 1000, segmentId: "seg-1" }],
          flagsFinal: [],
          axisScores: {
            utility: 90,
            portability: 88,
            naturalness: 84,
            c1_value: 83,
            context_robustness: 86,
          },
          scoreFinal: EXPRESSION_THRESHOLD + 5,
          decision: "pending",
          meaningJa: "",
          reasonShort: "",
          scenarioExample: "",
        },
      ],
      accepted: [],
      updatedAt: { marker: "state-ts" },
    };

    const stateDocRef = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => pipelineState,
      })),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(pipelineState, value);
      }),
    };

    getAdminDbMock.mockReturnValue({
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => stateDocRef,
          }),
        }),
      }),
    });

    await runMaterialPipelineStep({
      materialId: "mat-1",
      pipelineVersion: "v1",
      step: "reeval",
    });

    expect(pipelineState.candidates[0]).toMatchObject({
      decision: "accept",
      reeval: {
        source: "fallback",
        decision: "accept",
        errorCode: "invalid_response",
      },
    });
  });

  it("generates examples only for accepted expressions", async () => {
    isOpenAIEnabledMock.mockReturnValue(true);
    generateScenarioExampleWithOpenAIMock.mockResolvedValue(
      "We need to take ownership before the launch.",
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        responseData: {
          translatedText: "責任を持つ",
        },
        matches: [],
      }),
    });

    const pipelineState: {
      candidates: Array<Record<string, unknown>>;
      accepted: Array<Record<string, unknown>>;
      updatedAt: { marker: string };
    } = {
      candidates: [
        {
          expressionText: "take ownership",
          occurrences: [{ startMs: 0, endMs: 1000, segmentId: "seg-1" }],
          flagsFinal: [],
          axisScores: {
            utility: 90,
            portability: 88,
            naturalness: 84,
            c1_value: 83,
            context_robustness: 86,
          },
          scoreFinal: 80,
          decision: "accept",
          reeval: {
            source: "openai",
            decision: "accept",
            reasonShort: "会議でも汎用的で自然",
            meaningJa: "主体的に責任を持つこと",
          },
          meaningJa: "",
          reasonShort: "",
          scenarioExample: "",
        },
        {
          expressionText: "single word",
          occurrences: [{ startMs: 0, endMs: 1000, segmentId: "seg-2" }],
          flagsFinal: ["rare_occurrence"],
          axisScores: {
            utility: 30,
            portability: 30,
            naturalness: 30,
            c1_value: 30,
            context_robustness: 30,
          },
          scoreFinal: 20,
          decision: "reject",
          meaningJa: "",
          reasonShort: "",
          scenarioExample: "",
        },
      ],
      accepted: [
        {
          expressionText: "take ownership",
        },
      ],
      updatedAt: { marker: "state-ts" },
    };

    const stateDocRef = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => pipelineState,
      })),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(pipelineState, value);
      }),
    };

    getAdminDbMock.mockReturnValue({
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => stateDocRef,
          }),
        }),
      }),
    });

    await runMaterialPipelineStep({
      materialId: "mat-1",
      pipelineVersion: "v1",
      step: "examples",
    });

    expect(generateScenarioExampleWithOpenAIMock).toHaveBeenCalledTimes(1);
    expect(generateScenarioExampleWithOpenAIMock).toHaveBeenCalledWith("take ownership");
    expect(pipelineState.candidates[0]).toMatchObject({
      meaningJa: "「take ownership」は「責任を持つ」という意味。",
      reasonShort: "会議でも汎用的で自然",
      scenarioExample: "We need to take ownership before the launch.",
    });
    expect(pipelineState.candidates[1]).toMatchObject({
      scenarioExample: "",
    });
  });
});
