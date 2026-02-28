import { assertServerOnly } from "@/lib/server/assertServerOnly";
import { createOpenAIProvider } from "@/lib/server/llm/openaiProvider";
import type { GenerateTextInput, ServerLlmProvider } from "@/lib/server/llm/types";

export interface ServerLlmClient {
  generateText(input: GenerateTextInput): Promise<string>;
}

export function createServerLlmClient(options: { provider: ServerLlmProvider }): ServerLlmClient {
  assertServerOnly("Server LLM client");

  return {
    generateText(input: GenerateTextInput) {
      return options.provider.generateText(input);
    },
  };
}

let defaultClient: ServerLlmClient | undefined;

export function getDefaultServerLlmClient(): ServerLlmClient {
  assertServerOnly("Default server LLM client");

  if (!defaultClient) {
    defaultClient = createServerLlmClient({
      provider: createOpenAIProvider(),
    });
  }

  return defaultClient;
}
