import { getDefaultServerLlmClient } from "@/lib/server/llm/client";
import { ServerLlmError } from "@/lib/server/llm/errors";
import { isOpenAIConfigured } from "@/lib/server/llm/openaiProvider";

type ReevalDecision = "accept" | "reject";

export type OpenAIExpressionReevalInput = {
  expressionText: string;
  contextText?: string;
  scoreFinal: number;
  flagsFinal: string[];
  axisScores: {
    utility: number;
    portability: number;
    naturalness: number;
    c1_value: number;
    context_robustness: number;
  };
  occurrenceCount: number;
};

export type OpenAIExpressionReevalResult = {
  decision: ReevalDecision;
  reasonShort: string;
  meaningJa: string;
};

export function isOpenAIEnabled(): boolean {
  return isOpenAIConfigured();
}

function parseJsonObject(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonText = fencedMatch?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new ServerLlmError("OpenAI returned invalid JSON.", "invalid_response");
  }
}

function parseReevalResult(rawText: string): OpenAIExpressionReevalResult {
  const parsed = parseJsonObject(rawText);
  if (!parsed || typeof parsed !== "object") {
    throw new ServerLlmError("OpenAI returned invalid reeval payload.", "invalid_response");
  }

  const decision = "decision" in parsed ? parsed.decision : undefined;
  const reasonShort = "reasonShort" in parsed ? parsed.reasonShort : undefined;
  const meaningJa = "meaningJa" in parsed ? parsed.meaningJa : undefined;

  if (decision !== "accept" && decision !== "reject") {
    throw new ServerLlmError("OpenAI returned an invalid reeval decision.", "invalid_response");
  }
  if (typeof reasonShort !== "string" || !reasonShort.trim()) {
    throw new ServerLlmError("OpenAI returned an empty reeval reason.", "invalid_response");
  }
  if (typeof meaningJa !== "string" || !meaningJa.trim()) {
    throw new ServerLlmError("OpenAI returned an empty Japanese meaning.", "invalid_response");
  }

  return {
    decision,
    reasonShort: reasonShort.trim(),
    meaningJa: meaningJa.trim(),
  };
}

export async function generateScenarioExampleWithOpenAI(expressionText: string): Promise<string> {
  const content = await getDefaultServerLlmClient().generateText({
    systemPrompt:
      "You create one concise, natural English sentence for advanced learners. Return exactly one sentence only.",
    userPrompt: [
      `Create exactly one sentence that uses this adopted expression verbatim: "${expressionText}".`,
      "Do not use quotation marks.",
      "Do not add explanations, alternatives, or multiple sentences.",
    ].join(" "),
  });

  return content.trim();
}

export async function reevaluateExpressionWithOpenAI(
  input: OpenAIExpressionReevalInput,
): Promise<OpenAIExpressionReevalResult> {
  const content = await getDefaultServerLlmClient().generateText({
    systemPrompt: [
      "You review candidate English expressions for a Japanese listening-learning app.",
      "Strongly prefer idioms, phrasal verbs, and CEFR C1+ vocabulary.",
      "Reject generic fragments, pronoun+be chunks, plain prepositional phrases, and low-value collocations.",
      'Examples to reject: "more than", "it was", "in the skiing industry".',
      'Examples to accept when natural: "face the music", "freak out", "mitigate", "humdrum".',
      "Return exactly one JSON object with keys decision, reasonShort, meaningJa.",
      'decision must be either "accept" or "reject".',
      "reasonShort must be concise Japanese.",
      "meaningJa must be a short, natural Japanese gloss that works as a translation in the given context.",
      "Do not just restate the English expression or say that the meaning depends on context.",
    ].join(" "),
    userPrompt: JSON.stringify(input),
    temperature: 0,
  });

  return parseReevalResult(content);
}

export async function generateGlossaryMeaningJaWithOpenAI(surfaceText: string): Promise<string> {
  return getDefaultServerLlmClient().generateText({
    systemPrompt: "You explain English words/phrases for Japanese learners.",
    userPrompt: `次の英語語句の日本語の短い意味を1文で返してください: "${surfaceText}"`,
  });
}
