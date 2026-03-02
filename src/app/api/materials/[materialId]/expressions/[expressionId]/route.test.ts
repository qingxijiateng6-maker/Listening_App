import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/api/materials/[materialId]/expressions/[expressionId]/route";

const deleteMaterialExpressionMock = vi.fn();
const resolveRequestUserMock = vi.fn();

vi.mock("@/lib/server/materials", () => ({
  deleteMaterialExpression: (...args: unknown[]) => deleteMaterialExpressionMock(...args),
}));

vi.mock("@/lib/server/requestUser", () => ({
  resolveRequestUser: (...args: unknown[]) => resolveRequestUserMock(...args),
}));

describe("DELETE /api/materials/[materialId]/expressions/[expressionId]", () => {
  beforeEach(() => {
    deleteMaterialExpressionMock.mockReset();
    resolveRequestUserMock.mockReset();
  });

  it("returns 401 when the user is not authenticated", async () => {
    resolveRequestUserMock.mockResolvedValueOnce(null);

    const response = await DELETE(new Request("http://localhost/api/materials/mat-1/expressions/exp-1"), {
      params: Promise.resolve({ materialId: "mat-1", expressionId: "exp-1" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when the material does not exist", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    deleteMaterialExpressionMock.mockResolvedValueOnce(null);

    const response = await DELETE(new Request("http://localhost/api/materials/mat-1/expressions/exp-1"), {
      params: Promise.resolve({ materialId: "mat-1", expressionId: "exp-1" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Material not found" });
  });

  it("returns 404 when the expression does not exist", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    deleteMaterialExpressionMock.mockResolvedValueOnce(false);

    const response = await DELETE(new Request("http://localhost/api/materials/mat-1/expressions/exp-1"), {
      params: Promise.resolve({ materialId: "mat-1", expressionId: "exp-1" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Expression not found" });
  });

  it("deletes the expression", async () => {
    resolveRequestUserMock.mockResolvedValueOnce({ uid: "user-1" });
    deleteMaterialExpressionMock.mockResolvedValueOnce(true);

    const response = await DELETE(new Request("http://localhost/api/materials/mat-1/expressions/exp-1"), {
      params: Promise.resolve({ materialId: "mat-1", expressionId: "exp-1" }),
    });

    expect(deleteMaterialExpressionMock).toHaveBeenCalledWith("user-1", "mat-1", "exp-1");
    expect(response.status).toBe(204);
  });
});
