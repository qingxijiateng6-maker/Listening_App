import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/users/me/expressions/route";

const listUserExpressionsMock = vi.fn();

vi.mock("@/lib/server/userExpressions", () => ({
  listUserExpressions: (...args: unknown[]) => listUserExpressionsMock(...args),
}));

describe("GET /api/users/me/expressions", () => {
  beforeEach(() => {
    listUserExpressionsMock.mockReset();
  });

  it("returns unauthorized when user identity is missing", async () => {
    const response = await GET(new NextRequest("http://localhost/api/users/me/expressions"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns learning statuses for the current user", async () => {
    listUserExpressionsMock.mockResolvedValueOnce([
      {
        expressionId: "exp-1",
        status: "saved",
        updatedAt: "2026-02-28T00:00:00.000Z",
      },
    ]);

    const request = new NextRequest("http://localhost/api/users/me/expressions", {
      headers: {
        "x-user-id": "anon-user-1",
      },
    });

    const response = await GET(request);

    expect(listUserExpressionsMock).toHaveBeenCalledWith("anon-user-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      expressions: [
        {
          expressionId: "exp-1",
          status: "saved",
          updatedAt: "2026-02-28T00:00:00.000Z",
        },
      ],
    });
  });
});
