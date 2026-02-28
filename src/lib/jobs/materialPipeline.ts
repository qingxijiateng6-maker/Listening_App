import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  formatCaptionCues,
  getMaterialPipelineCaptionProvider,
  type CaptionFetchResult,
  type FormattedSegment,
} from "@/lib/jobs/materialPipelineCaptions";
import {
  generateScenarioExampleWithOpenAI,
  isOpenAIEnabled,
  reevaluateExpressionWithOpenAI,
} from "@/lib/llm/openai";
import { ServerLlmError } from "@/lib/server/llm/errors";
import type { JobStep } from "@/types/domain";

const THRESHOLD = 75;
const MAX_NGRAM = 4;
const MIN_WORD_LEN = 2;
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
]);
const UNSAFE_TERMS = ["porn", "hate", "kill", "racist", "suicide", "sexual assault"];

type SegmentRecord = {
  startMs: number;
  endMs: number;
  text: string;
};

export type InMemorySegment = SegmentRecord & { id: string };

type Occurrence = {
  startMs: number;
  endMs: number;
  segmentId: string;
};

type AxisScores = {
  utility: number;
  portability: number;
  naturalness: number;
  c1_value: number;
  context_robustness: number;
};

type Candidate = {
  expressionText: string;
  occurrences: Occurrence[];
  flagsFinal: string[];
  axisScores: AxisScores;
  scoreFinal: number;
  decision: "pending" | "accept" | "reject";
  reeval?: {
    source: "heuristic" | "openai" | "fallback";
    decision: "accept" | "reject";
    reasonShort: string;
    meaningJa: string;
    errorCode?: ServerLlmError["code"];
  };
  meaningJa: string;
  reasonShort: string;
  scenarioExample: string;
};

type PipelineState = {
  meta?: {
    youtubeId: string;
    youtubeUrl: string;
    title: string;
    channel: string;
    durationSec: number;
  };
  captions?: CaptionFetchResult;
  formattedSegmentCount?: number;
  candidates: Candidate[];
  accepted: Candidate[];
  persistedCount?: number;
  updatedAt: Timestamp;
};

type MaterialRecord = {
  youtubeId: string;
  youtubeUrl: string;
  title?: string;
  channel?: string;
  durationSec?: number;
};

function expressionId(expressionText: string): string {
  return createHash("sha1").update(expressionText).digest("hex");
}

function nowTs(): Timestamp {
  return Timestamp.now();
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).filter(
    (token) => token.length >= MIN_WORD_LEN,
  );
}

function buildMeaningJa(expressionText: string): string {
  return `${expressionText} の意味（文脈依存）`;
}

function buildReason(candidate: Candidate): string {
  return `5軸評価=${candidate.scoreFinal}, 出現=${candidate.occurrences.length}`;
}

function buildScenarioExample(expressionText: string): string {
  return `In a meeting, I used "${expressionText}" to explain my point clearly.`;
}

async function buildScenarioExampleAsync(expressionText: string): Promise<string> {
  if (!isOpenAIEnabled()) {
    return buildScenarioExample(expressionText);
  }
  try {
    return await generateScenarioExampleWithOpenAI(expressionText);
  } catch {
    return buildScenarioExample(expressionText);
  }
}

function buildHeuristicReeval(candidate: Candidate): NonNullable<Candidate["reeval"]> {
  const decision: NonNullable<Candidate["reeval"]>["decision"] = decideAcceptance(
    candidate.scoreFinal,
    candidate.flagsFinal,
  )
    ? "accept"
    : "reject";

  return {
    source: "heuristic",
    decision,
    reasonShort: buildReason(candidate),
    meaningJa: buildMeaningJa(candidate.expressionText),
  };
}

function buildFallbackReeval(
  candidate: Candidate,
  error: unknown,
): NonNullable<Candidate["reeval"]> {
  const heuristic = buildHeuristicReeval(candidate);

  return {
    ...heuristic,
    source: "fallback",
    errorCode: error instanceof ServerLlmError ? error.code : undefined,
  };
}

function hasUnsafeTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return UNSAFE_TERMS.some((term) => lower.includes(term));
}

function addFlag(candidate: Candidate, flag: string): Candidate {
  if (candidate.flagsFinal.includes(flag)) {
    return candidate;
  }
  return { ...candidate, flagsFinal: [...candidate.flagsFinal, flag] };
}

function computeAxisScores(expressionText: string, occurrences: Occurrence[]): AxisScores {
  const words = expressionText.split(" ");
  const wordCount = words.length;
  const frequency = occurrences.length;

  const utility = clamp(55 + Math.min(35, frequency * 10) + (wordCount >= 2 ? 10 : 0));
  const portability = clamp(
    82 - (/\d/.test(expressionText) ? 20 : 0) - (wordCount > 5 ? 10 : 0),
  );
  const naturalness = clamp(75 + (/[a-z]/.test(expressionText) ? 8 : -12) - (wordCount > 6 ? 8 : 0));
  const c1Value = clamp(45 + (wordCount >= 2 ? 22 : -10) + (wordCount >= 3 ? 15 : 0));
  const contextRobustness = clamp(45 + Math.min(45, frequency * 12));

  return {
    utility,
    portability,
    naturalness,
    c1_value: c1Value,
    context_robustness: contextRobustness,
  };
}

export const EXPRESSION_THRESHOLD = THRESHOLD;

export function decideAcceptance(scoreFinal: number, flagsFinal: string[]): boolean {
  if (flagsFinal.includes("unsafe_or_inappropriate")) {
    return false;
  }
  return scoreFinal >= THRESHOLD;
}

export function runExpressionPipelineInMemory(
  segments: InMemorySegment[],
  options?: {
    generateScenarioExample?: (expressionText: string) => string;
  },
): { accepted: Candidate[]; rejected: Candidate[] } {
  const candidateMap = new Map<string, Candidate>();
  segments.forEach((segment) => {
    const tokens = tokenize(segment.text);
    for (let n = 1; n <= MAX_NGRAM; n += 1) {
      for (let i = 0; i <= tokens.length - n; i += 1) {
        const phrase = tokens.slice(i, i + n).join(" ");
        const occurrence: Occurrence = {
          startMs: segment.startMs,
          endMs: segment.endMs,
          segmentId: segment.id,
        };
        const existing = candidateMap.get(phrase);
        if (!existing) {
          candidateMap.set(phrase, buildInitialCandidate(phrase, occurrence));
        } else {
          existing.occurrences.push(occurrence);
        }
      }
    }
  });

  const filtered = Array.from(candidateMap.values()).filter((candidate) =>
    filterCandidate(candidate.expressionText),
  );

  const scored = filtered.map((candidate) => {
    const axisScores = computeAxisScores(candidate.expressionText, candidate.occurrences);
    return applyFlags({ ...candidate, axisScores });
  });

  const reevaled: Candidate[] = scored.map((candidate) => {
    const decision: Candidate["decision"] = decideAcceptance(candidate.scoreFinal, candidate.flagsFinal)
      ? "accept"
      : "reject";
    return {
      ...candidate,
      decision,
    };
  });

  const accepted: Candidate[] = reevaled
    .filter((candidate) => candidate.decision === "accept")
    .map((candidate): Candidate => {
      const makeExample = options?.generateScenarioExample ?? buildScenarioExample;
      return {
        ...candidate,
        meaningJa: buildMeaningJa(candidate.expressionText),
        reasonShort: buildReason(candidate),
        scenarioExample: makeExample(candidate.expressionText),
      };
    });
  const rejected: Candidate[] = reevaled.filter((candidate) => candidate.decision === "reject");

  return { accepted, rejected };
}

function applyFlags(candidate: Candidate): Candidate {
  let next = candidate;

  if (candidate.expressionText.split(" ").length === 1) {
    next = addFlag(next, "single_word");
  }
  if (candidate.occurrences.length === 1) {
    next = addFlag(next, "rare_occurrence");
  }
  if (hasUnsafeTerm(candidate.expressionText)) {
    next = addFlag(next, "unsafe_or_inappropriate");
  }

  let penalty = 0;
  if (next.flagsFinal.includes("single_word")) {
    penalty += 12;
  }
  if (next.flagsFinal.includes("rare_occurrence")) {
    penalty += 8;
  }
  if (next.flagsFinal.includes("unsafe_or_inappropriate")) {
    penalty += 100;
  }

  const axis = next.axisScores;
  const weighted =
    axis.utility * 0.25 +
    axis.portability * 0.2 +
    axis.naturalness * 0.2 +
    axis.c1_value * 0.2 +
    axis.context_robustness * 0.15;

  return {
    ...next,
    scoreFinal: clamp(weighted - penalty),
  };
}

function filterCandidate(expressionText: string): boolean {
  if (expressionText.length < 3) {
    return false;
  }
  if (expressionText.includes("http")) {
    return false;
  }
  const words = expressionText.split(" ");
  if (words.length === 1 && STOP_WORDS.has(words[0])) {
    return false;
  }
  return true;
}

function buildInitialCandidate(expressionText: string, occurrence: Occurrence): Candidate {
  return {
    expressionText,
    occurrences: [occurrence],
    flagsFinal: [],
    axisScores: {
      utility: 0,
      portability: 0,
      naturalness: 0,
      c1_value: 0,
      context_robustness: 0,
    },
    scoreFinal: 0,
    decision: "pending",
    meaningJa: "",
    reasonShort: "",
    scenarioExample: "",
  };
}

function stateRef(materialId: string, pipelineVersion: string) {
  return getAdminDb()
    .collection("materials")
    .doc(materialId)
    .collection("_pipeline")
    .doc(`state:${pipelineVersion}`);
}

async function readState(materialId: string, pipelineVersion: string): Promise<PipelineState> {
  const snapshot = await stateRef(materialId, pipelineVersion).get();
  if (!snapshot.exists) {
    return { candidates: [], accepted: [], updatedAt: nowTs() };
  }
  const data = snapshot.data() as PipelineState;
  return {
    meta: data.meta,
    captions: data.captions,
    formattedSegmentCount: data.formattedSegmentCount,
    candidates: data.candidates ?? [],
    accepted: data.accepted ?? [],
    persistedCount: data.persistedCount,
    updatedAt: data.updatedAt ?? nowTs(),
  };
}

async function writeState(materialId: string, pipelineVersion: string, state: PipelineState): Promise<void> {
  await stateRef(materialId, pipelineVersion).set({ ...state, updatedAt: nowTs() }, { merge: true });
}

async function readMaterial(materialId: string): Promise<MaterialRecord> {
  const snapshot = await getAdminDb().collection("materials").doc(materialId).get();
  if (!snapshot.exists) {
    throw new Error(`Material not found: ${materialId}`);
  }

  const material = snapshot.data() as MaterialRecord;
  if (!material.youtubeId || !material.youtubeUrl) {
    throw new Error(`Material ${materialId} is missing YouTube metadata.`);
  }

  return material;
}

async function replaceSegments(materialId: string, segments: FormattedSegment[]): Promise<void> {
  const db = getAdminDb();
  const segmentsCollection = db.collection("materials").doc(materialId).collection("segments");
  const existingSnapshot = await segmentsCollection.get();
  const batch = db.batch();

  existingSnapshot.docs.forEach((docSnapshot) => {
    batch.delete(docSnapshot.ref);
  });

  segments.forEach((segment) => {
    batch.set(segmentsCollection.doc(segment.id), {
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    });
  });

  await batch.commit();
}

async function runMeta(materialId: string, pipelineVersion: string): Promise<void> {
  const state = await readState(materialId, pipelineVersion);
  const material = await readMaterial(materialId);

  await writeState(materialId, pipelineVersion, {
    ...state,
    meta: {
      youtubeId: material.youtubeId,
      youtubeUrl: material.youtubeUrl,
      title: material.title ?? "",
      channel: material.channel ?? "",
      durationSec: material.durationSec ?? 0,
    },
    updatedAt: nowTs(),
  });
}

async function runCaptions(materialId: string, pipelineVersion: string): Promise<void> {
  const state = await readState(materialId, pipelineVersion);
  const materialMeta =
    state.meta ??
    (() => {
      throw new Error(`Meta step must run before captions for material ${materialId}.`);
    })();
  const provider = getMaterialPipelineCaptionProvider();
  const captions = await provider.fetchCaptions({
    materialId,
    youtubeId: materialMeta.youtubeId,
    youtubeUrl: materialMeta.youtubeUrl,
  });

  await writeState(materialId, pipelineVersion, {
    ...state,
    captions,
    updatedAt: nowTs(),
  });
}

async function runFormat(materialId: string, pipelineVersion: string): Promise<void> {
  const state = await readState(materialId, pipelineVersion);
  if (!state.captions) {
    throw new Error(`Captions step must run before format for material ${materialId}.`);
  }

  const formattedSegments =
    state.captions.status === "fetched" ? formatCaptionCues(state.captions.cues) : [];

  await replaceSegments(materialId, formattedSegments);
  await writeState(materialId, pipelineVersion, {
    ...state,
    formattedSegmentCount: formattedSegments.length,
    updatedAt: nowTs(),
  });
}

async function runExtract(materialId: string, pipelineVersion: string): Promise<void> {
  const db = getAdminDb();
  const segmentsSnapshot = await db.collection("materials").doc(materialId).collection("segments").get();
  const candidateMap = new Map<string, Candidate>();

  segmentsSnapshot.docs.forEach((segmentDoc) => {
    const segment = segmentDoc.data() as SegmentRecord;
    const tokens = tokenize(segment.text);
    for (let n = 1; n <= MAX_NGRAM; n += 1) {
      for (let i = 0; i <= tokens.length - n; i += 1) {
        const phrase = tokens.slice(i, i + n).join(" ");
        const occurrence: Occurrence = {
          startMs: segment.startMs,
          endMs: segment.endMs,
          segmentId: segmentDoc.id,
        };
        const existing = candidateMap.get(phrase);
        if (!existing) {
          candidateMap.set(phrase, buildInitialCandidate(phrase, occurrence));
        } else {
          existing.occurrences.push(occurrence);
        }
      }
    }
  });

  await writeState(materialId, pipelineVersion, {
    candidates: Array.from(candidateMap.values()),
    accepted: [],
    updatedAt: nowTs(),
  });
}

async function runFilter(materialId: string, pipelineVersion: string): Promise<void> {
  const state = await readState(materialId, pipelineVersion);
  const filtered = state.candidates.filter((candidate) => filterCandidate(candidate.expressionText));
  await writeState(materialId, pipelineVersion, { ...state, candidates: filtered, updatedAt: nowTs() });
}

async function runScore(materialId: string, pipelineVersion: string): Promise<void> {
  const state = await readState(materialId, pipelineVersion);
  const scored = state.candidates.map((candidate) => {
    const axisScores = computeAxisScores(candidate.expressionText, candidate.occurrences);
    return applyFlags({ ...candidate, axisScores });
  });
  await writeState(materialId, pipelineVersion, { ...state, candidates: scored, updatedAt: nowTs() });
}

async function runReeval(materialId: string, pipelineVersion: string): Promise<void> {
  const state = await readState(materialId, pipelineVersion);
  const updated = await Promise.all(
    state.candidates.map(async (candidate) => {
      if (!isOpenAIEnabled()) {
        const reeval = buildHeuristicReeval(candidate);
        return { ...candidate, decision: reeval.decision, reeval };
      }

      try {
        const llmReeval = await reevaluateExpressionWithOpenAI({
          expressionText: candidate.expressionText,
          scoreFinal: candidate.scoreFinal,
          flagsFinal: candidate.flagsFinal,
          axisScores: candidate.axisScores,
          occurrenceCount: candidate.occurrences.length,
        });
        const decision: Candidate["decision"] = candidate.flagsFinal.includes("unsafe_or_inappropriate")
          ? "reject"
          : llmReeval.decision;

        return {
          ...candidate,
          decision,
          reeval: {
            source: "openai" as const,
            decision,
            reasonShort: llmReeval.reasonShort,
            meaningJa: llmReeval.meaningJa,
          },
        };
      } catch (error) {
        const reeval = buildFallbackReeval(candidate, error);
        return { ...candidate, decision: reeval.decision, reeval };
      }
    }),
  );

  const accepted = updated.filter((candidate) => candidate.decision === "accept");
  await writeState(materialId, pipelineVersion, { ...state, candidates: updated, accepted, updatedAt: nowTs() });
}

async function runExamples(materialId: string, pipelineVersion: string): Promise<void> {
  const state = await readState(materialId, pipelineVersion);
  const acceptedWithExamples = await Promise.all(
    state.candidates
      .filter((candidate) => candidate.decision === "accept")
      .map(async (candidate) => ({
        expressionText: candidate.expressionText,
        scenarioExample: await buildScenarioExampleAsync(candidate.expressionText),
      })),
  );
  const exampleMap = new Map(
    acceptedWithExamples.map((entry) => [entry.expressionText, entry.scenarioExample]),
  );

  const updatedCandidates = state.candidates.map((candidate) => {
    if (candidate.decision !== "accept") {
      return candidate;
    }
    return {
      ...candidate,
      meaningJa: candidate.reeval?.meaningJa ?? buildMeaningJa(candidate.expressionText),
      reasonShort: candidate.reeval?.reasonShort ?? buildReason(candidate),
      scenarioExample: exampleMap.get(candidate.expressionText) ?? buildScenarioExample(candidate.expressionText),
    };
  });
  const accepted = updatedCandidates.filter((candidate) => candidate.decision === "accept");
  await writeState(materialId, pipelineVersion, {
    ...state,
    candidates: updatedCandidates,
    accepted,
    updatedAt: nowTs(),
  });
}

async function runPersist(materialId: string, pipelineVersion: string): Promise<void> {
  const db = getAdminDb();
  const state = await readState(materialId, pipelineVersion);
  const accepted = state.accepted.filter(
    (candidate) =>
      candidate.scoreFinal >= THRESHOLD &&
      !candidate.flagsFinal.includes("unsafe_or_inappropriate"),
  );

  const acceptedById = accepted
    .map((candidate) => ({
      candidate,
      expressionDocId: expressionId(candidate.expressionText),
    }))
    .sort((left, right) => left.expressionDocId.localeCompare(right.expressionDocId));

  const existingSnapshots = await Promise.all(
    acceptedById.map(({ expressionDocId }) =>
      db.collection("materials").doc(materialId).collection("expressions").doc(expressionDocId).get(),
    ),
  );
  const existingById = new Map(
    existingSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [snapshot.id, snapshot.data() as { createdAt?: Timestamp }]),
  );

  const batch = db.batch();
  acceptedById.forEach(({ candidate, expressionDocId }) => {
    const ref = db.collection("materials").doc(materialId).collection("expressions").doc(expressionDocId);
    const existing = existingById.get(expressionDocId);
    batch.set(
      ref,
      {
        expressionText: candidate.expressionText,
        scoreFinal: candidate.scoreFinal,
        axisScores: candidate.axisScores,
        meaningJa: candidate.meaningJa || buildMeaningJa(candidate.expressionText),
        reasonShort: candidate.reasonShort || buildReason(candidate),
        scenarioExample: candidate.scenarioExample || buildScenarioExample(candidate.expressionText),
        flagsFinal: candidate.flagsFinal,
        occurrences: candidate.occurrences,
        createdAt: existing?.createdAt ?? nowTs(),
      },
      { merge: true },
    );
  });
  await batch.commit();

  await stateRef(materialId, pipelineVersion).set(
    {
      persistedCount: acceptedById.length,
      updatedAt: nowTs(),
    },
    { merge: true },
  );
}

export async function runMaterialPipelineStep(input: {
  materialId: string;
  pipelineVersion: string;
  step: JobStep;
}): Promise<void> {
  switch (input.step) {
    case "meta":
      await runMeta(input.materialId, input.pipelineVersion);
      return;
    case "captions":
      await runCaptions(input.materialId, input.pipelineVersion);
      return;
    case "format":
      await runFormat(input.materialId, input.pipelineVersion);
      return;
    case "extract":
      await runExtract(input.materialId, input.pipelineVersion);
      return;
    case "filter":
      await runFilter(input.materialId, input.pipelineVersion);
      return;
    case "score":
      await runScore(input.materialId, input.pipelineVersion);
      return;
    case "reeval":
      await runReeval(input.materialId, input.pipelineVersion);
      return;
    case "examples":
      await runExamples(input.materialId, input.pipelineVersion);
      return;
    case "persist":
      await runPersist(input.materialId, input.pipelineVersion);
      return;
    default:
      return;
  }
}
