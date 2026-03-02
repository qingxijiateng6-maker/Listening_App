import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resolveRequestUser } from "@/lib/server/requestUser";

const verifyIdTokenMock = vi.fn();
const getAdminAuthMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => getAdminAuthMock(),
}));

describe("resolveRequestUser", () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset();
    getAdminAuthMock.mockReset();
  });

  it("returns the verified firebase id token user when available", async () => {
    verifyIdTokenMock.mockResolvedValueOnce({ uid: "verified-user" });
    getAdminAuthMock.mockReturnValueOnce({
      verifyIdToken: verifyIdTokenMock,
    });

    const user = await resolveRequestUser(
      new NextRequest("http://localhost/api/materials", {
        headers: {
          authorization: "Bearer token-123",
          "x-user-id": "fallback-user",
        },
      }),
    );

    expect(verifyIdTokenMock).toHaveBeenCalledWith("token-123");
    expect(user).toEqual({
      uid: "verified-user",
      source: "firebase-id-token",
    });
  });

  it("falls back to x-user-id when firebase token verification fails", async () => {
    verifyIdTokenMock.mockRejectedValueOnce(new Error("token invalid"));
    getAdminAuthMock.mockReturnValueOnce({
      verifyIdToken: verifyIdTokenMock,
    });

    const user = await resolveRequestUser(
      new NextRequest("http://localhost/api/materials", {
        headers: {
          authorization: "Bearer invalid-token",
          "x-user-id": "fallback-user",
        },
      }),
    );

    expect(user).toEqual({
      uid: "fallback-user",
      source: "x-user-id",
    });
  });

  it("falls back to x-user-id when firebase admin auth cannot initialize", async () => {
    getAdminAuthMock.mockImplementationOnce(() => {
      throw new Error("Missing Firebase Admin env vars");
    });

    const user = await resolveRequestUser(
      new NextRequest("http://localhost/api/materials", {
        headers: {
          authorization: "Bearer token-123",
          "x-user-id": "fallback-user",
        },
      }),
    );

    expect(user).toEqual({
      uid: "fallback-user",
      source: "x-user-id",
    });
  });

  it("returns null when neither firebase auth nor fallback headers are available", async () => {
    const user = await resolveRequestUser(new NextRequest("http://localhost/api/materials"));

    expect(user).toBeNull();
  });
});
