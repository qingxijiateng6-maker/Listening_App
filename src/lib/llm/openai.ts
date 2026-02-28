import { getDefaultServerLlmClient } from "@/lib/server/llm/client";
import { isOpenAIConfigured } from "@/lib/server/llm/openaiProvider";

export function isOpenAIEnabled(): boolean {
  return isOpenAIConfigured();
}

export async function generateScenarioExampleWithOpenAI(expressionText: string): Promise<string> {
  return getDefaultServerLlmClient().generateText({
    systemPrompt: "You create one concise, natural English sentence for advanced learners.",
    userPrompt: `Create exactly one sentence using this expression naturally: "${expressionText}".`,
  });
}

export async function generateGlossaryMeaningJaWithOpenAI(surfaceText: string): Promise<string> {
  return getDefaultServerLlmClient().generateText({
    systemPrompt: "You explain English words/phrases for Japanese learners.",
    userPrompt: `次の英語語句の日本語の短い意味を1文で返してください: "${surfaceText}"`,
  });
}
