import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PUT } from "@/app/api/users/me/expressions/[expressionId]/route";

const upsertUserExpressionMock = vi.fn();

vi.mock("@/lib/server/userExpressions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/userExpressions")>(
    "@/lib/server/userExpressions",
  );

  return {
    ...actual,
    upsertUserExpression: (...args: unknown[]) => upsertUserExpressionMock(...args),
  };
});

describe("PUT /api/users/me/expressions/[expressionId]", () => {
  beforeEach(() => {
    upsertUserExpressionMock.mockReset();
  });

  it("returns unauthorized when user identity is missing", async () => {
    const request = new NextRequest("http://localhost/api/users/me/expressions/exp-1", {
      method: "PUT",
      body: JSON.stringify({ status: "saved" }),
      headers: {
        "content-type": "application/json",
      },
    });

    const response = await PUT(request, { params: Promise.resolve({ expressionId: "exp-1" }) });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("rejects an unknown status", async () => {
    const request = new NextRequest("http://localhost/api/users/me/expressions/exp-1", {
      method: "PUT",
      body: JSON.stringify({ status: "unknown" }),
      headers: {
        "content-type": "application/json",
        "x-user-id": "anon-user-1",
      },
    });

    const response = await PUT(request, { params: Promise.resolve({ expressionId: "exp-1" }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid status" });
    expect(upsertUserExpressionMock).not.toHaveBeenCalled();
  });

  it("updates the current user's learning status", async () => {
    upsertUserExpressionMock.mockResolvedValueOnce({
      expressionId: "exp-1",
      status: "mastered",
      updatedAt: "2026-02-28T00:00:00.000Z",
    });

    const request = new NextRequest("http://localhost/api/users/me/expressions/exp-1", {
      method: "PUT",
      body: JSON.stringify({ status: "mastered" }),
      headers: {
        "content-type": "application/json",
        "x-user-id": "anon-user-1",
      },
    });

    const response = await PUT(request, { params: Promise.resolve({ expressionId: "exp-1" }) });

    expect(upsertUserExpressionMock).toHaveBeenCalledWith("anon-user-1", "exp-1", "mastered");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      expressionId: "exp-1",
      status: "mastered",
      updatedAt: "2026-02-28T00:00:00.000Z",
    });
  });
});
