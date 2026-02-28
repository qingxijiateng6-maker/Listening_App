import { afterEach, describe, expect, it, vi } from "vitest";

import { createServerLlmClient } from "@/lib/server/llm/client";
import {
  createOpenAIProvider,
  getOpenAIProviderConfig,
  isOpenAIConfigured,
} from "@/lib/server/llm/openaiProvider";

const ORIGINAL_ENV = { ...process.env };

describe("openai provider", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("reads env config with defaults", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_TIMEOUT_MS;

    expect(getOpenAIProviderConfig()).toEqual({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      timeoutMs: 8000,
    });
  });

  it("rejects invalid timeout values", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_TIMEOUT_MS = "0";

    expect(() => getOpenAIProviderConfig()).toThrowError(/OPENAI_TIMEOUT_MS must be a positive number\./);
  });

  it("returns generated content", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: " generated text " } }],
        }),
        { status: 200 },
      ),
    );
    const provider = createOpenAIProvider({
      config: {
        apiKey: "sk-test",
        model: "gpt-4.1-mini",
        baseUrl: "https://example.com/v1/",
        timeoutMs: 1000,
      },
      fetchImplementation,
    });

    const client = createServerLlmClient({ provider });
    const content = await client.generateText({
      systemPrompt: "system",
      userPrompt: "user",
      temperature: 0.4,
    });

    expect(content).toBe("generated text");
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer sk-test",
        }),
      }),
    );
  });

  it("wraps upstream http failures", async () => {
    const provider = createOpenAIProvider({
      config: {
        apiKey: "sk-test",
        model: "gpt-4o-mini",
        baseUrl: "https://example.com/v1",
        timeoutMs: 1000,
      },
      fetchImplementation: vi.fn(async () => new Response("boom", { status: 429 })),
    });

    await expect(
      provider.generateText({
        systemPrompt: "system",
        userPrompt: "user",
      }),
    ).rejects.toMatchObject({
      name: "ServerLlmError",
      code: "request_failed",
      message: "OpenAI request failed with status 429.",
    });
  });

  it("maps aborts to timeout errors", async () => {
    vi.useFakeTimers();
    try {
      const fetchImplementation = vi.fn(
        ({}, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );

      const provider = createOpenAIProvider({
        config: {
          apiKey: "sk-test",
          model: "gpt-4o-mini",
          baseUrl: "https://example.com/v1",
          timeoutMs: 10,
        },
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
      });

      const assertion = expect(
        provider.generateText({
          systemPrompt: "system",
          userPrompt: "user",
        }),
      ).rejects.toMatchObject({
        name: "ServerLlmError",
        code: "timeout",
      });

      await vi.advanceTimersByTimeAsync(20);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports whether openai is configured", () => {
    delete process.env.OPENAI_API_KEY;
    expect(isOpenAIConfigured()).toBe(false);

    process.env.OPENAI_API_KEY = "sk-test";
    expect(isOpenAIConfigured()).toBe(true);
  });
});
