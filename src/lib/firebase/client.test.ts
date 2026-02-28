import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envKeys = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

const initializeAppMock = vi.fn();
const getAppsMock = vi.fn();
const getAppMock = vi.fn();

vi.mock("firebase/app", () => ({
  getApp: getAppMock,
  getApps: getAppsMock,
  initializeApp: initializeAppMock,
}));

describe("getFirebaseApp", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    envKeys.forEach((key) => {
      delete process.env[key];
    });
  });

  afterEach(() => {
    envKeys.forEach((key) => {
      const originalValue = originalEnv[key];
      if (typeof originalValue === "string") {
        process.env[key] = originalValue;
        return;
      }

      delete process.env[key];
    });
  });

  it("returns null and exposes a short error when env vars are missing", async () => {
    getAppsMock.mockReturnValue([]);

    const { getFirebaseApp, getFirebaseClientError } = await import("@/lib/firebase/client");

    expect(getFirebaseApp()).toBeNull();
    expect(getFirebaseClientError()?.message).toBe("Firebase設定が不足しています。");
    expect(initializeAppMock).not.toHaveBeenCalled();
  });

  it("returns the initialized app when config is valid", async () => {
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockReturnValue({ name: "test-app" });

    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "api-key";
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "auth-domain";
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "project-id";
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "bucket";
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = "sender";
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID = "app-id";

    const { getFirebaseApp, getFirebaseClientError } = await import("@/lib/firebase/client");

    expect(getFirebaseApp()).toEqual({ name: "test-app" });
    expect(getFirebaseClientError()).toBeNull();
    expect(initializeAppMock).toHaveBeenCalledTimes(1);
  });
});
