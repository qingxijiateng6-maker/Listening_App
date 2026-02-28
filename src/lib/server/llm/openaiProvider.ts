import { assertServerOnly } from "@/lib/server/assertServerOnly";
import { ServerLlmError } from "@/lib/server/llm/errors";
import type { GenerateTextInput, OpenAIProviderConfig, ServerLlmProvider } from "@/lib/server/llm/types";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_TIMEOUT_MS = 8000;

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

type OpenAIProviderOptions = {
  config?: OpenAIProviderConfig;
  fetchImplementation?: typeof fetch;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function parseTimeoutMs(rawValue: string | undefined): number {
  if (!rawValue) {
    return DEFAULT_OPENAI_TIMEOUT_MS;
  }

  const timeoutMs = Number(rawValue);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ServerLlmError("OPENAI_TIMEOUT_MS must be a positive number.", "configuration_error");
  }

  return timeoutMs;
}

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getOpenAIProviderConfig(): OpenAIProviderConfig {
  assertServerOnly("OpenAI provider config");

  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new ServerLlmError("OPENAI_API_KEY is not set.", "configuration_error");
  }

  return {
    apiKey,
    model: process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL),
    timeoutMs: parseTimeoutMs(process.env.OPENAI_TIMEOUT_MS),
  };
}

function extractContent(payload: OpenAIChatCompletionResponse): string {
  return payload.choices?.[0]?.message?.content?.trim() ?? "";
}

export function createOpenAIProvider(options: OpenAIProviderOptions = {}): ServerLlmProvider {
  assertServerOnly("OpenAI provider");

  const config = options.config
    ? {
        ...options.config,
        baseUrl: normalizeBaseUrl(options.config.baseUrl),
      }
    : getOpenAIProviderConfig();
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return {
    name: "openai",
    async generateText(input: GenerateTextInput): Promise<string> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error("timeout")), config.timeoutMs);

      try {
        let response: Response;

        try {
          response = await fetchImplementation(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              temperature: input.temperature ?? 0.2,
              messages: [
                { role: "system", content: input.systemPrompt },
                { role: "user", content: input.userPrompt },
              ],
            }),
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw new ServerLlmError(
              `OpenAI request timed out after ${config.timeoutMs}ms.`,
              "timeout",
              { cause: error },
            );
          }

          throw new ServerLlmError("OpenAI request failed.", "request_failed", { cause: error });
        }

        if (!response.ok) {
          throw new ServerLlmError(`OpenAI request failed with status ${response.status}.`, "request_failed");
        }

        const payload = (await response.json()) as OpenAIChatCompletionResponse;
        const content = extractContent(payload);
        if (!content) {
          throw new ServerLlmError("OpenAI returned empty content.", "invalid_response");
        }

        return content;
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
