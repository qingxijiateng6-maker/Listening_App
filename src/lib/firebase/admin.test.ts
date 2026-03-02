import { beforeEach, describe, expect, it, vi } from "vitest";

const certMock = vi.fn((value: unknown) => value);
const initializeAppMock = vi.fn((_value: unknown) => ({ name: "admin-app" }));
const getAppsMock = vi.fn();
const getAuthMock = vi.fn((_value: unknown) => ({ kind: "auth" }));
const getFirestoreMock = vi.fn((_value: unknown) => ({ kind: "firestore" }));

vi.mock("firebase-admin/app", () => ({
  cert: (value: unknown) => certMock(value),
  getApps: () => getAppsMock(),
  initializeApp: (value: unknown) => initializeAppMock(value),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: (value: unknown) => getAuthMock(value),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: (value: unknown) => getFirestoreMock(value),
}));

import {
  getAdminAuth,
  getAdminDb,
  normalizeFirebasePrivateKey,
} from "@/lib/firebase/admin";

describe("firebase admin helpers", () => {
  beforeEach(() => {
    certMock.mockClear();
    initializeAppMock.mockClear();
    getAppsMock.mockReset();
    getAuthMock.mockClear();
    getFirestoreMock.mockClear();
    getAppsMock.mockReturnValue([]);
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
  });

  it("normalizes quoted multiline private keys", () => {
    expect(
      normalizeFirebasePrivateKey("\"-----BEGIN PRIVATE KEY-----\\nline-1\\n-----END PRIVATE KEY-----\\n\""),
    ).toBe("-----BEGIN PRIVATE KEY-----\nline-1\n-----END PRIVATE KEY-----\n");
  });

  it("initializes firebase admin with normalized env values", () => {
    process.env.FIREBASE_PROJECT_ID = "  demo-project  ";
    process.env.FIREBASE_CLIENT_EMAIL = "\"firebase-adminsdk@test.example.com\"";
    process.env.FIREBASE_PRIVATE_KEY = "\"-----BEGIN PRIVATE KEY-----\\nline-1\\n-----END PRIVATE KEY-----\\n\"";

    getAdminDb();

    expect(certMock).toHaveBeenCalledWith({
      projectId: "demo-project",
      clientEmail: "firebase-adminsdk@test.example.com",
      privateKey: "-----BEGIN PRIVATE KEY-----\nline-1\n-----END PRIVATE KEY-----\n",
    });
    expect(initializeAppMock).toHaveBeenCalledOnce();
    expect(getFirestoreMock).toHaveBeenCalled();
  });

  it("reuses an existing firebase admin app", () => {
    const existingApp = { name: "existing-app" };
    getAppsMock.mockReturnValue([existingApp]);

    getAdminAuth();

    expect(initializeAppMock).not.toHaveBeenCalled();
    expect(getAuthMock).toHaveBeenCalledWith(existingApp);
  });
});
