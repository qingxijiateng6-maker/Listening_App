import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/materials/[materialId]/expressions/route";

const listMaterialExpressionsMock = vi.fn();
const createMaterialExpressionMock = vi.fn();
const resolveRequestUserMock = vi.fn();

vi.mock("@/lib/server/materials", () => ({
  listMaterialExpressions: (...args: unknown[]) => listMaterialExpressionsMock(...args),
  createMaterialExpression: (...args: unknown[]) => createMaterialExpressionMock(...args),
}));

vi.mock("@/lib/server/requestUser", () => ({
  resolveRequestUser: (...args: unknown[]) => resolveRequestUserMock(...args),
}));

describe("GET /api/materials/[materialId]/expressions", () => {
  beforeEach(() => {
    listMaterialExpressionsMock.mockReset();
    createMaterialExpressionMock.mockReset();
    resolveRequestUserMock.mockReset();
  });

  it("returns 401 when the user is not authenticated", async () => {
    resolveRequestUserMock.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/api/materials/mat-1/expressions"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when the material does not exist", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    listMaterialExpressionsMock.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/api/materials/mat-1/expressions"), {
      params: Promise.resolve({ materialId: "mat-1" }),
    });

    expect(listMaterialExpressionsMock).toHaveBeenCalledWith("user-1", "mat-1");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Material not found" });
  });

  it("returns the material expressions", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
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

    expect(listMaterialExpressionsMock).toHaveBeenCalledWith("user-1", "mat-1");
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
    resolveRequestUserMock.mockReset();
  });

  it("returns 401 when the user is not authenticated", async () => {
    resolveRequestUserMock.mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/materials/mat-1/expressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expression: "hello", meaning: "意味", exampleSentence: "example" }),
      }),
      {
        params: Promise.resolve({ materialId: "mat-1" }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 400 for invalid payloads", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
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
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
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

    expect(createMaterialExpressionMock).toHaveBeenCalledWith("user-1", "mat-1", {
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
