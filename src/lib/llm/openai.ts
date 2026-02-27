const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_TIMEOUT_MS = 8000;

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

function getOpenAIConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? DEFAULT_OPENAI_TIMEOUT_MS),
  };
}

function extractContent(payload: ChatCompletionResponse): string {
  return payload.choices?.[0]?.message?.content?.trim() ?? "";
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const config = getOpenAIConfig();
  if (!config.apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = extractContent(payload);
    if (!content) {
      throw new Error("OpenAI returned empty content.");
    }
    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isOpenAIEnabled(): boolean {
  return (process.env.OPENAI_API_KEY ?? "").length > 0;
}

export async function generateScenarioExampleWithOpenAI(expressionText: string): Promise<string> {
  return callOpenAI(
    "You create one concise, natural English sentence for advanced learners.",
    `Create exactly one sentence using this expression naturally: "${expressionText}".`,
  );
}

export async function generateGlossaryMeaningJaWithOpenAI(surfaceText: string): Promise<string> {
  return callOpenAI(
    "You explain English words/phrases for Japanese learners.",
    `次の英語語句の日本語の短い意味を1文で返してください: "${surfaceText}"`,
  );
}
