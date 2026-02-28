import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/materials/[materialId]/glossary/route";
import { glossaryHash } from "@/lib/glossary";

const getMock = vi.fn();
const setMock = vi.fn();
const docMock = vi.fn();
const glossaryCollectionMock = vi.fn();
const materialDocMock = vi.fn();
const materialsCollectionMock = vi.fn();
const getAdminDbMock = vi.fn();
const isOpenAIEnabledMock = vi.fn();
const generateGlossaryMeaningJaWithOpenAIMock = vi.fn();

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    now: () => ({ seconds: 1, nanoseconds: 0 }),
  },
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => getAdminDbMock(),
}));

vi.mock("@/lib/llm/openai", () => ({
  isOpenAIEnabled: () => isOpenAIEnabledMock(),
  generateGlossaryMeaningJaWithOpenAI: (...args: unknown[]) => generateGlossaryMeaningJaWithOpenAIMock(...args),
}));

describe("POST /api/materials/[materialId]/glossary", () => {
  beforeEach(() => {
    getMock.mockReset();
    setMock.mockReset();
    docMock.mockReset();
    glossaryCollectionMock.mockReset();
    materialDocMock.mockReset();
    materialsCollectionMock.mockReset();
    getAdminDbMock.mockReset();
    isOpenAIEnabledMock.mockReset();
    generateGlossaryMeaningJaWithOpenAIMock.mockReset();

    docMock.mockReturnValue({
      get: getMock,
      set: setMock,
    });
    glossaryCollectionMock.mockReturnValue({
      doc: docMock,
    });
    materialDocMock.mockReturnValue({
      collection: glossaryCollectionMock,
    });
    materialsCollectionMock.mockReturnValue({
      doc: materialDocMock,
    });
    getAdminDbMock.mockReturnValue({
      collection: materialsCollectionMock,
    });
  });

  it("reuses the same cache key for normalized surface text variants", async () => {
    getMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ meaningJa: "責任を持つ" }),
    });

    const response = await POST(
      new Request("http://localhost/api/materials/mat-1/glossary", {
        method: "POST",
        body: JSON.stringify({ surfaceText: "  “Take   Ownership.”  " }),
        headers: { "content-type": "application/json" },
      }) as never,
      { params: Promise.resolve({ materialId: "mat-1" }) },
    );

    expect(materialDocMock).toHaveBeenCalledWith("mat-1");
    expect(docMock).toHaveBeenCalledTimes(1);
    expect(docMock.mock.calls[0]?.[0]).toBe(glossaryHash("take ownership"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      surfaceText: "take ownership",
      meaningJa: "責任を持つ",
      cacheHit: true,
    });
  });

  it("stores a normalized surface text and improved fallback meaning when generation is unavailable", async () => {
    getMock.mockResolvedValueOnce({
      exists: false,
    });
    isOpenAIEnabledMock.mockReturnValue(false);

    const response = await POST(
      new Request("http://localhost/api/materials/mat-1/glossary", {
        method: "POST",
        body: JSON.stringify({ surfaceText: "  End - to - End  " }),
        headers: { "content-type": "application/json" },
      }) as never,
      { params: Promise.resolve({ materialId: "mat-1" }) },
    );

    expect(setMock).toHaveBeenCalledWith({
      surfaceText: "end-to-end",
      meaningJa: "「end-to-end」はフレーズ表現で、文脈に応じて自然な訳し方が変わります。",
      createdAt: { seconds: 1, nanoseconds: 0 },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      surfaceText: "end-to-end",
      meaningJa: "「end-to-end」はフレーズ表現で、文脈に応じて自然な訳し方が変わります。",
      cacheHit: false,
    });
  });
});
