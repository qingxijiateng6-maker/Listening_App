export type GenerateTextInput = {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
};

export interface ServerLlmProvider {
  readonly name: string;
  generateText(input: GenerateTextInput): Promise<string>;
}

export type OpenAIProviderConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
};
