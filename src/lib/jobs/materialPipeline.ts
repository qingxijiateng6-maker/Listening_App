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
const MAX_PIPELINE_CANDIDATES = 250;
const MAX_STORED_OCCURRENCES = 8;
const MAX_WORDS_PER_EXPRESSION = 4;
const MAX_ACCEPTED_EXPRESSIONS = 20;
const MEANING_TRANSLATION_TIMEOUT_MS = 3500;
const MEANING_TRANSLATION_ENDPOINT = "https://api.mymemory.translated.net/get";
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
const FUNCTION_WORDS = new Set([
  ...STOP_WORDS,
  "me",
  "him",
  "her",
  "them",
  "my",
  "your",
  "his",
  "their",
  "our",
  "its",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "not",
  "no",
  "than",
  "then",
  "there",
  "here",
]);
const PREPOSITIONS = new Set([
  "in",
  "on",
  "at",
  "by",
  "for",
  "from",
  "with",
  "about",
  "against",
  "between",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "under",
  "over",
  "within",
  "without",
]);
const PARTICLES = new Set([
  "up",
  "out",
  "off",
  "on",
  "down",
  "away",
  "back",
  "around",
  "through",
  "over",
  "into",
]);
const COMMON_WORDS = new Set([
  ...FUNCTION_WORDS,
  "all",
  "also",
  "another",
  "any",
  "ask",
  "because",
  "become",
  "best",
  "better",
  "big",
  "call",
  "change",
  "come",
  "day",
  "even",
  "every",
  "feel",
  "find",
  "first",
  "forward",
  "get",
  "give",
  "good",
  "great",
  "group",
  "hand",
  "help",
  "high",
  "home",
  "important",
  "industry",
  "job",
  "keep",
  "know",
  "large",
  "last",
  "leave",
  "life",
  "little",
  "look",
  "lot",
  "make",
  "man",
  "many",
  "meet",
  "moment",
  "money",
  "month",
  "more",
  "most",
  "move",
  "music",
  "need",
  "new",
  "next",
  "old",
  "other",
  "part",
  "people",
  "place",
  "point",
  "put",
  "right",
  "run",
  "same",
  "say",
  "see",
  "show",
  "small",
  "start",
  "state",
  "still",
  "take",
  "team",
  "tell",
  "thing",
  "think",
  "time",
  "train",
  "try",
  "turn",
  "use",
  "want",
  "way",
  "week",
  "well",
  "work",
  "world",
  "year",
]);
const ADVANCED_WORD_AFFIXES = [
  "ate",
  "ence",
  "ency",
  "ent",
  "hood",
  "iate",
  "ify",
  "ious",
  "ism",
  "ist",
  "ition",
  "itive",
  "itude",
  "ize",
  "logy",
  "ment",
  "ness",
  "ology",
  "ship",
  "sion",
  "tion",
  "tive",
];
const UNSAFE_TERMS = ["porn", "hate", "kill", "racist", "suicide", "sexual assault"];
const LOW_VALUE_EXACT_PHRASES = new Set([
  "it is",
  "it was",
  "there is",
  "there are",
  "there was",
  "there were",
  "this is",
  "that is",
  "i was",
  "we are",
  "you are",
  "more than",
  "less than",
  "a lot of",
  "one of the",
]);

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

const EXACT_MEANINGS_JA: Record<string, string> = {
  "align on priorities": "優先順位について認識をそろえる",
  "face the music": "厳しい現実を受け入れる",
  "freak out": "ひどく動揺する",
  humdrum: "単調で退屈な",
  mitigate: "和らげる",
  "move forward": "前に進む",
  "take ownership": "主体的に責任を持つ",
};

const SINGLE_WORD_MEANINGS_JA: Record<string, string> = {
  abrupt: "突然の",
  ambiguous: "曖昧な",
  coherent: "一貫した",
  compelling: "説得力のある",
  cumbersome: "扱いにくい",
  detrimental: "有害な",
  diligent: "勤勉な",
  discrepancy: "食い違い",
  feasible: "実行可能な",
  fragile: "壊れやすい",
  humdrum: "単調で退屈な",
  inevitable: "避けられない",
  intricate: "複雑な",
  mitigate: "和らげる",
  nuanced: "微妙な差異を含む",
  tedious: "うんざりするほど退屈な",
  tentative: "暫定的な",
  viable: "実行可能な",
};

const PHRASAL_VERB_MEANINGS_JA: Record<string, string> = {
  "back up": "裏づける",
  "break down": "故障する",
  "bring up": "持ち出す",
  "carry out": "実行する",
  "figure out": "理解する",
  "find out": "知る",
  "freak out": "ひどく動揺する",
  "point out": "指摘する",
  "set up": "準備する",
  "sort out": "整理して解決する",
  "take on": "引き受ける",
  "turn out": "結果的にそうなる",
  "work out": "うまくいく",
};

function expressionId(expressionText: string): string {
  return createHash("sha1").update(expressionText).digest("hex");
}

function nowTs(): Timestamp {
  return Timestamp.now();
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).flatMap(([key, entryValue]) => {
      if (entryValue === undefined) {
        return [];
      }
      return [[key, stripUndefined(entryValue)]];
    });
    return Object.fromEntries(entries) as T;
  }

  return value;
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).filter(
    (token) => token.length >= MIN_WORD_LEN,
  );
}

function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word);
}

function isAdvancedSingleWord(word: string): boolean {
  if (word.includes("'") || word.includes("-")) {
    return false;
  }
  if (FUNCTION_WORDS.has(word) || isCommonWord(word)) {
    return false;
  }
  if (word.length >= 8) {
    return true;
  }
  if (word.length >= 7 && /[bdgkmpt]{2}|[aeiou]{2}/.test(word)) {
    return true;
  }
  return ADVANCED_WORD_AFFIXES.some((affix) => word.endsWith(affix) && word.length >= affix.length + 3);
}

function isLikelyPhrasalVerb(words: string[]): boolean {
  if (words.length < 2 || words.length > MAX_WORDS_PER_EXPRESSION) {
    return false;
  }
  if (FUNCTION_WORDS.has(words[0])) {
    return false;
  }

  return words.slice(1).some((word) => PARTICLES.has(word));
}

function isLikelyIdiomPattern(words: string[]): boolean {
  if (words.length !== 3) {
    return false;
  }

  const [first, second, third] = words;
  if (FUNCTION_WORDS.has(first) || FUNCTION_WORDS.has(third)) {
    return false;
  }

  return ["a", "an", "the", "your", "my", "his", "her", "our", "their"].includes(second);
}

function buildMeaningJa(expressionText: string, contextText?: string): string {
  const normalized = expressionText.trim().toLowerCase();
  const exactMeaning = EXACT_MEANINGS_JA[normalized];
  if (exactMeaning) {
    return exactMeaning;
  }

  const words = normalized.split(" ");
  if (words.length === 1) {
    return SINGLE_WORD_MEANINGS_JA[normalized] ?? `「${normalized}」に近い意味のやや難しい語`;
  }

  const phrasalVerbMeaning = PHRASAL_VERB_MEANINGS_JA[normalized];
  if (phrasalVerbMeaning) {
    return phrasalVerbMeaning;
  }

  if (words.length === 3 && words[1] === "the") {
    const object = words[2];
    if (object === "music") {
      return "厳しい現実を受け入れる";
    }
    return `${object}に向き合う`;
  }

  if (words.length >= 2 && words[0] === "align" && words[1] === "on") {
    return words.length > 2
      ? `${words.slice(2).join(" ")}について認識をそろえる`
      : "認識をそろえる";
  }

  if (words.length >= 2 && words[0] === "take" && words[1] === "ownership") {
    return "主体的に責任を持つ";
  }

  if (words.length >= 2 && words[0] === "move" && words[1] === "forward") {
    return "前に進む";
  }

  if (words.length >= 2 && words[0] === "face") {
    return "直面する";
  }

  if (contextText) {
    return `文脈では「${normalized}」は重要な内容を表す表現`;
  }

  return `「${normalized}」に近い意味の表現`;
}

function buildReason(candidate: Candidate): string {
  return `5軸評価=${candidate.scoreFinal}, 出現=${candidate.occurrences.length}`;
}

function buildScenarioExample(expressionText: string, contextText?: string): string {
  if (contextText && contextText.toLowerCase().includes(expressionText.toLowerCase())) {
    return contextText;
  }
  return `In a meeting, I used "${expressionText}" to explain my point clearly.`;
}

async function buildScenarioExampleAsync(expressionText: string, contextText?: string): Promise<string> {
  if (!isOpenAIEnabled()) {
    return buildScenarioExample(expressionText, contextText);
  }
  try {
    return await generateScenarioExampleWithOpenAI(expressionText);
  } catch {
    return buildScenarioExample(expressionText, contextText);
  }
}

function looksJapanese(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function normalizeTranslatedMeaning(translatedText: string): string {
  return translatedText
    .replace(/\s+/g, " ")
    .replace(/^["'`「『（(]+|["'`」』）).。]+$/g, "")
    .trim();
}

async function fetchMeaningJaOnline(expressionText: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEANING_TRANSLATION_TIMEOUT_MS);

  try {
    const query = new URLSearchParams({
      q: expressionText,
      langpair: "en|ja",
    });
    const response = await fetch(`${MEANING_TRANSLATION_ENDPOINT}?${query.toString()}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      responseData?: { translatedText?: string };
      matches?: Array<{ translation?: string; match?: number; quality?: number | string }>;
    };

    const candidates = [
      payload.responseData?.translatedText,
      ...(payload.matches ?? [])
        .sort(
          (left, right) =>
            Number(right.match ?? 0) - Number(left.match ?? 0) ||
            Number(right.quality ?? 0) - Number(left.quality ?? 0),
        )
        .map((entry) => entry.translation),
    ]
      .map((value) => normalizeTranslatedMeaning(value ?? ""))
      .filter((value) => value.length > 0);

    return candidates.find((value) => looksJapanese(value) && value.toLowerCase() !== expressionText.toLowerCase()) ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildMeaningJaAsync(expressionText: string, contextText?: string): Promise<string> {
  const translated = await fetchMeaningJaOnline(expressionText);
  if (translated) {
    return contextText
      ? `この文脈では「${expressionText}」は「${translated}」という意味。`
      : `「${expressionText}」は「${translated}」という意味。`;
  }

  return buildMeaningJa(expressionText, contextText);
}

function buildHeuristicReeval(
  candidate: Candidate,
  contextText?: string,
): NonNullable<Candidate["reeval"]> {
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
    meaningJa: buildMeaningJa(candidate.expressionText, contextText),
  };
}

function buildFallbackReeval(
  candidate: Candidate,
  error: unknown,
  contextText?: string,
): NonNullable<Candidate["reeval"]> {
  const heuristic = buildHeuristicReeval(candidate, contextText);

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

function getCandidateContextText(
  candidate: Candidate,
  segmentTextById: Map<string, string>,
): string | undefined {
  const firstOccurrence = candidate.occurrences[0];
  if (!firstOccurrence) {
    return undefined;
  }

  return segmentTextById.get(firstOccurrence.segmentId);
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
  const advancedSingleWord = wordCount === 1 && isAdvancedSingleWord(words[0]);
  const idiomCandidate = isLikelyPhrasalVerb(words) || isLikelyIdiomPattern(words);

  const utility = clamp(
    40 +
      Math.min(28, frequency * 8) +
      (idiomCandidate ? 28 : 0) +
      (advancedSingleWord ? 28 : 0) +
      (wordCount >= 2 ? 6 : 0),
  );
  const portability = clamp(
    70 +
      (idiomCandidate ? 20 : 0) +
      (advancedSingleWord ? 18 : 0) -
      (/\d/.test(expressionText) ? 20 : 0) -
      (wordCount > MAX_WORDS_PER_EXPRESSION ? 10 : 0),
  );
  const naturalness = clamp(
    62 + (/[a-z]/.test(expressionText) ? 8 : -12) + (idiomCandidate ? 14 : 0) - (wordCount > 4 ? 8 : 0),
  );
  const c1Value = clamp(
    18 + (advancedSingleWord ? 72 : 0) + (idiomCandidate ? 44 : 0) + (wordCount >= 3 ? 8 : 0),
  );
  const contextRobustness = clamp(35 + Math.min(40, frequency * 10) + (idiomCandidate ? 10 : 0));

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
    generateScenarioExample?: (expressionText: string, contextText?: string) => string;
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
    .sort(
      (left, right) =>
        right.scoreFinal - left.scoreFinal ||
        right.occurrences.length - left.occurrences.length ||
        left.expressionText.localeCompare(right.expressionText),
    )
    .slice(0, MAX_ACCEPTED_EXPRESSIONS)
    .map((candidate): Candidate => {
      const makeExample = options?.generateScenarioExample ?? buildScenarioExample;
      const contextText = segments.find((segment) => segment.id === candidate.occurrences[0]?.segmentId)?.text;
      return {
        ...candidate,
        meaningJa: buildMeaningJa(candidate.expressionText, contextText),
        reasonShort: buildReason(candidate),
        scenarioExample: makeExample(candidate.expressionText, contextText),
      };
    });
  const acceptedTexts = new Set(accepted.map((candidate) => candidate.expressionText));
  const rejected: Candidate[] = reevaled.filter(
    (candidate) => candidate.decision === "reject" || !acceptedTexts.has(candidate.expressionText),
  );

  return { accepted, rejected };
}

function applyFlags(candidate: Candidate): Candidate {
  let next = candidate;
  const words = candidate.expressionText.split(" ");
  const advancedSingleWord = words.length === 1 && isAdvancedSingleWord(words[0]);
  const idiomCandidate = isLikelyPhrasalVerb(words) || isLikelyIdiomPattern(words);

  if (words.length === 1) {
    next = addFlag(next, "single_word");
  }
  if (advancedSingleWord) {
    next = addFlag(next, "advanced_single_word");
  }
  if (idiomCandidate) {
    next = addFlag(next, "idiom_candidate");
  }
  if (candidate.occurrences.length === 1) {
    next = addFlag(next, "rare_occurrence");
  }
  if (hasUnsafeTerm(candidate.expressionText)) {
    next = addFlag(next, "unsafe_or_inappropriate");
  }

  let penalty = 0;
  if (next.flagsFinal.includes("single_word") && !next.flagsFinal.includes("advanced_single_word")) {
    penalty += 12;
  }
  if (next.flagsFinal.includes("rare_occurrence")) {
    penalty += next.flagsFinal.includes("advanced_single_word") || next.flagsFinal.includes("idiom_candidate") ? 0 : 8;
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
  if (LOW_VALUE_EXACT_PHRASES.has(expressionText)) {
    return false;
  }
  const words = expressionText.split(" ");
  if (words.length > MAX_WORDS_PER_EXPRESSION) {
    return false;
  }
  if (words.length === 1 && STOP_WORDS.has(words[0])) {
    return false;
  }
  if (words.every((word) => FUNCTION_WORDS.has(word))) {
    return false;
  }
  if (words.length >= 2 && ["there", "it", "this", "that", "these", "those"].includes(words[0])) {
    return false;
  }
  if (words.length >= 2 && ["is", "are", "was", "were", "be", "been", "being"].includes(words[1])) {
    return false;
  }
  if (words.length === 1) {
    return isAdvancedSingleWord(words[0]);
  }
  if (PREPOSITIONS.has(words[0])) {
    return false;
  }
  if (["is", "are", "was", "were", "be", "been", "being"].includes(words[0])) {
    return false;
  }
  if (["it", "this", "that", "there", "here"].includes(words[0])) {
    return false;
  }
  if (words[words.length - 1] && FUNCTION_WORDS.has(words[words.length - 1])) {
    return false;
  }
  if (words.every((word) => isCommonWord(word)) && !isLikelyPhrasalVerb(words) && !isLikelyIdiomPattern(words)) {
    return false;
  }
  if (words.length === 2 && !isLikelyPhrasalVerb(words)) {
    return false;
  }
  if (words.length >= 3 && !isLikelyPhrasalVerb(words) && !isLikelyIdiomPattern(words)) {
    const contentWordCount = words.filter((word) => !FUNCTION_WORDS.has(word)).length;
    const uncommonWordCount = words.filter((word) => !isCommonWord(word)).length;
    return contentWordCount >= 2 && uncommonWordCount >= 1;
  }
  return true;
}

function selectTopAcceptedCandidates(candidates: Candidate[]): Candidate[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.decision === "accept" &&
        !candidate.flagsFinal.includes("unsafe_or_inappropriate"),
    )
    .sort(
      (left, right) =>
        right.scoreFinal - left.scoreFinal ||
        right.occurrences.length - left.occurrences.length ||
        left.expressionText.localeCompare(right.expressionText),
    )
    .slice(0, MAX_ACCEPTED_EXPRESSIONS);
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

function compactCandidate(candidate: Candidate): Candidate {
  return {
    ...candidate,
    occurrences: candidate.occurrences.slice(0, MAX_STORED_OCCURRENCES),
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
  await stateRef(materialId, pipelineVersion).set(stripUndefined({ ...state, updatedAt: nowTs() }), {
    merge: true,
  });
}

async function readSegmentTextById(materialId: string): Promise<Map<string, string>> {
  try {
    const snapshot = await getAdminDb().collection("materials").doc(materialId).collection("segments").get();
    return new Map(
      snapshot.docs.map((segmentDoc) => {
        const segment = segmentDoc.data() as SegmentRecord;
        return [segmentDoc.id, segment.text] as const;
      }),
    );
  } catch {
    return new Map();
  }
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

  if (captions.status !== "fetched") {
    throw new Error(captions.message);
  }

  await getAdminDb().collection("materials").doc(materialId).set(
    {
      title: captions.metadata?.title ?? materialMeta.title,
      channel: captions.metadata?.channel ?? materialMeta.channel,
      durationSec: captions.metadata?.durationSec ?? materialMeta.durationSec,
      updatedAt: nowTs(),
    },
    { merge: true },
  );

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
  const segments: InMemorySegment[] = segmentsSnapshot.docs.map((segmentDoc) => {
    const segment = segmentDoc.data() as SegmentRecord;
    return {
      id: segmentDoc.id,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    };
  });

  const { accepted, rejected } = runExpressionPipelineInMemory(segments, {
    generateScenarioExample: () => "",
  });
  const compactedCandidates = [...accepted, ...rejected]
    .sort(
      (left, right) =>
        right.scoreFinal - left.scoreFinal ||
        right.occurrences.length - left.occurrences.length ||
        left.expressionText.localeCompare(right.expressionText),
    )
    .slice(0, MAX_PIPELINE_CANDIDATES)
    .map((candidate) => compactCandidate(candidate));
  const compactedAccepted = compactedCandidates.filter((candidate) => candidate.decision === "accept");

  await writeState(materialId, pipelineVersion, {
    candidates: compactedCandidates,
    accepted: compactedAccepted,
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
  const segmentTextById = await readSegmentTextById(materialId);
  const updated = await Promise.all(
    state.candidates.map(async (candidate) => {
      const contextText = getCandidateContextText(candidate, segmentTextById);
      if (!isOpenAIEnabled()) {
        const reeval = buildHeuristicReeval(candidate, contextText);
        return { ...candidate, decision: reeval.decision, reeval };
      }

      try {
        const llmReeval = await reevaluateExpressionWithOpenAI({
          expressionText: candidate.expressionText,
          contextText,
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
        const reeval = buildFallbackReeval(candidate, error, contextText);
        return { ...candidate, decision: reeval.decision, reeval };
      }
    }),
  );

  const accepted = selectTopAcceptedCandidates(updated);
  await writeState(materialId, pipelineVersion, { ...state, candidates: updated, accepted, updatedAt: nowTs() });
}

async function runExamples(materialId: string, pipelineVersion: string): Promise<void> {
  const state = await readState(materialId, pipelineVersion);
  const segmentTextById = await readSegmentTextById(materialId);
  const acceptedCandidates = selectTopAcceptedCandidates(state.candidates);
  const acceptedWithDetails = await Promise.all(
    acceptedCandidates.map(async (candidate) => {
      const contextText = getCandidateContextText(candidate, segmentTextById);
      return {
        expressionText: candidate.expressionText,
        meaningJa: await buildMeaningJaAsync(candidate.expressionText, contextText),
        scenarioExample: await buildScenarioExampleAsync(candidate.expressionText, contextText),
      };
    }),
  );
  const detailMap = new Map(acceptedWithDetails.map((entry) => [entry.expressionText, entry]));
  const acceptedTexts = new Set(acceptedCandidates.map((candidate) => candidate.expressionText));

  const updatedCandidates = state.candidates.map((candidate) => {
    if (!acceptedTexts.has(candidate.expressionText)) {
      return candidate.decision === "accept" ? { ...candidate, decision: "reject" as const } : candidate;
    }

    const contextText = getCandidateContextText(candidate, segmentTextById);
    const details = detailMap.get(candidate.expressionText);
    if (!details) {
      return candidate;
    }
    return {
      ...candidate,
      meaningJa: details.meaningJa || buildMeaningJa(candidate.expressionText, contextText),
      reasonShort: candidate.reeval?.reasonShort ?? buildReason(candidate),
      scenarioExample: details.scenarioExample || buildScenarioExample(candidate.expressionText, contextText),
    };
  });
  const accepted = selectTopAcceptedCandidates(updatedCandidates);
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
  const segmentTextById = await readSegmentTextById(materialId);
  const accepted = selectTopAcceptedCandidates(state.accepted);

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
        meaningJa:
          candidate.meaningJa ||
          buildMeaningJa(candidate.expressionText, getCandidateContextText(candidate, segmentTextById)),
        reasonShort: candidate.reasonShort || buildReason(candidate),
        scenarioExample:
          candidate.scenarioExample ||
          buildScenarioExample(candidate.expressionText, getCandidateContextText(candidate, segmentTextById)),
        flagsFinal: candidate.flagsFinal,
        occurrences: candidate.occurrences,
        createdAt: existing?.createdAt ?? nowTs(),
      },
      { merge: true },
    );
  });

  const allExpressionSnapshots = await db.collection("materials").doc(materialId).collection("expressions").get();
  const keepIds = new Set(acceptedById.map(({ expressionDocId }) => expressionDocId));
  allExpressionSnapshots.docs.forEach((snapshot) => {
    if (!keepIds.has(snapshot.id)) {
      batch.delete(snapshot.ref);
    }
  });
  await batch.commit();

  await stateRef(materialId, pipelineVersion).set(
    stripUndefined({
      persistedCount: acceptedById.length,
      updatedAt: nowTs(),
    }),
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
