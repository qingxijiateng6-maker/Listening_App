import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/materials/[materialId]/expressions/route";

const listMaterialExpressionsMock = vi.fn();
const createMaterialExpressionMock = vi.fn();

vi.mock("@/lib/server/materials", () => ({
  listMaterialExpressions: (...args: unknown[]) => listMaterialExpressionsMock(...args),
  createMaterialExpression: (...args: unknown[]) => createMaterialExpressionMock(...args),
}));

describe("GET /api/materials/[materialId]/expressions", () => {
  beforeEach(() => {
    listMaterialExpressionsMock.mockReset();
    createMaterialExpressionMock.mockReset();
  });

  it("returns 404 when the material does not exist", async () => {
    listMaterialExpressionsMock.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/api/materials/mat-1/expressions"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(listMaterialExpressionsMock).toHaveBeenCalledWith("mat-1");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Material not found" });
  });

  it("returns the material expressions", async () => {
    listMaterialExpressionsMock.mockResolvedValueOnce([
      {
        expressionId: "exp-1",
        expression: "take ownership",
        meaning: "責任を持つ",
        exampleSentence: "Take ownership of the issue.",
      },
    ]);

    const response = await GET(new Request("http://localhost/api/materials/mat-1/expressions"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      expressions: [
        {
          expressionId: "exp-1",
          expression: "take ownership",
          meaning: "責任を持つ",
          exampleSentence: "Take ownership of the issue.",
        },
      ],
    });
  });
});

describe("POST /api/materials/[materialId]/expressions", () => {
  beforeEach(() => {
    createMaterialExpressionMock.mockReset();
  });

  it("returns 400 for invalid payloads", async () => {
    const response = await POST(
      new Request("http://localhost/api/materials/mat-1/expressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expression: "hello", meaning: "" }),
      }),
      {
        params: Promise.resolve({ materialId: "mat-1" }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "expression, meaning, and exampleSentence are required",
    });
  });

  it("creates and returns a saved expression", async () => {
    createMaterialExpressionMock.mockResolvedValueOnce({
      expressionId: "exp-1",
      expression: "take ownership",
      meaning: "責任を持つ",
      exampleSentence: "Take ownership of the issue.",
      createdAt: { seconds: 10, nanoseconds: 0, toMillis: () => 10000 },
      updatedAt: { seconds: 10, nanoseconds: 0, toMillis: () => 10000 },
    });

    const response = await POST(
      new Request("http://localhost/api/materials/mat-1/expressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expression: " take ownership ",
          meaning: " 責任を持つ ",
          exampleSentence: " Take ownership of the issue. ",
        }),
      }),
      {
        params: Promise.resolve({ materialId: "mat-1" }),
      },
    );

    expect(createMaterialExpressionMock).toHaveBeenCalledWith("mat-1", {
      expression: "take ownership",
      meaning: "責任を持つ",
      exampleSentence: "Take ownership of the issue.",
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      expression: {
        expressionId: "exp-1",
        expression: "take ownership",
        meaning: "責任を持つ",
        exampleSentence: "Take ownership of the issue.",
        createdAt: { seconds: 10, nanoseconds: 0 },
        updatedAt: { seconds: 10, nanoseconds: 0 },
      },
    });
  });
});
