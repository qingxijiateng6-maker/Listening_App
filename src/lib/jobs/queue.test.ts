import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { computeBackoffSeconds, isLockStale } from "@/lib/jobs/queue";

describe("queue retry policy", () => {
  it("uses exponential backoff", () => {
    expect(computeBackoffSeconds(1)).toBe(30);
    expect(computeBackoffSeconds(2)).toBe(60);
    expect(computeBackoffSeconds(3)).toBe(120);
  });
});

describe("job lock policy", () => {
  it("marks stale lock when lockedAt is too old", () => {
    const now = Timestamp.fromMillis(1_000_000);
    const old = Timestamp.fromMillis(1_000_000 - 11 * 60 * 1000);
    expect(isLockStale(old, now)).toBe(true);
  });

  it("keeps lock valid when within ttl", () => {
    const now = Timestamp.fromMillis(1_000_000);
    const recent = Timestamp.fromMillis(1_000_000 - 2 * 60 * 1000);
    expect(isLockStale(recent, now)).toBe(false);
  });
});
