import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import type { CaptionFetchResult, FormattedSegment } from "@/lib/jobs/materialPipelineCaptions";

type StoredValue = Record<string, unknown>;
type DocPath = string[];

class MockDocSnapshot {
  constructor(
    readonly ref: MockDocRef,
    private readonly value: StoredValue | undefined,
  ) {}

  get exists() {
    return this.value !== undefined;
  }

  data() {
    return this.value;
  }
}

class MockQuerySnapshot {
  constructor(readonly docs: MockDocSnapshot[]) {}
}

class MockDocRef {
  constructor(
    private readonly db: MockFirestore,
    readonly path: DocPath,
  ) {}

  collection(name: string) {
    return new MockCollectionRef(this.db, [...this.path, name]);
  }

  async get() {
    return new MockDocSnapshot(this, this.db.read(this.path));
  }

  async set(value: StoredValue, options?: { merge?: boolean }) {
    this.db.write(this.path, value, options);
  }
}

class MockCollectionRef {
  constructor(
    private readonly db: MockFirestore,
    readonly path: string[],
  ) {}

  doc(id: string) {
    return new MockDocRef(this.db, [...this.path, id]);
  }

  async get() {
    return new MockQuerySnapshot(
      this.db.list(this.path).map(({ path, value }) => new MockDocSnapshot(new MockDocRef(this.db, path), value)),
    );
  }
}

class MockWriteBatch {
  private readonly operations: Array<() => void> = [];

  constructor(private readonly db: MockFirestore) {}

  delete(ref: MockDocRef) {
    this.operations.push(() => {
      this.db.delete(ref.path);
    });
  }

  set(ref: MockDocRef, value: StoredValue) {
    this.operations.push(() => {
      this.db.write(ref.path, value);
    });
  }

  async commit() {
    this.operations.forEach((operation) => operation());
  }
}

class MockFirestore {
  private readonly docs = new Map<string, StoredValue>();

  collection(name: string) {
    return new MockCollectionRef(this, [name]);
  }

  batch() {
    return new MockWriteBatch(this);
  }

  seed(path: DocPath, value: StoredValue) {
    this.docs.set(this.key(path), structuredClone(value));
  }

  read(path: DocPath) {
    const value = this.docs.get(this.key(path));
    return value ? structuredClone(value) : undefined;
  }

  write(path: DocPath, value: StoredValue, options?: { merge?: boolean }) {
    const key = this.key(path);
    const nextValue = structuredClone(value);
    if (options?.merge) {
      this.docs.set(key, { ...(this.docs.get(key) ?? {}), ...nextValue });
      return;
    }
    this.docs.set(key, nextValue);
  }

  delete(path: DocPath) {
    this.docs.delete(this.key(path));
  }

  list(collectionPath: string[]) {
    return [...this.docs.entries()]
      .map(([key, value]) => ({ path: key.split("/"), value }))
      .filter(({ path }) => path.length === collectionPath.length + 1)
      .filter(({ path }) => collectionPath.every((segment, index) => path[index] === segment));
  }

  private key(path: DocPath) {
    return path.join("/");
  }
}

type MockContext = {
  db: MockFirestore;
  fetchCaptions: ReturnType<typeof vi.fn<(...args: never[]) => Promise<CaptionFetchResult>>>;
};

const mockContext = vi.hoisted(
  () =>
    ({
      db: null as unknown as MockFirestore,
      fetchCaptions: vi.fn<(...args: never[]) => Promise<CaptionFetchResult>>(),
    }) as MockContext,
);

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => mockContext.db,
}));

vi.mock("@/lib/jobs/materialPipelineCaptions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/jobs/materialPipelineCaptions")>(
    "@/lib/jobs/materialPipelineCaptions",
  );
  return {
    ...actual,
    getMaterialPipelineCaptionProvider: () => ({
      fetchCaptions: mockContext.fetchCaptions,
    }),
  };
});

import { runMaterialPipelineStep } from "@/lib/jobs/materialPipeline";

function segmentTexts(segments: FormattedSegment[]) {
  return segments.map((segment) => segment.text);
}

describe("runMaterialPipelineStep", () => {
  beforeEach(() => {
    mockContext.fetchCaptions.mockReset();
    mockContext.db = new MockFirestore();
  });

  it("persists material metadata into pipeline state during the meta step", async () => {
    mockContext.db.seed(["materials", "mat-1"], {
      youtubeId: "yt-123",
      youtubeUrl: "https://youtu.be/yt-123",
      title: "Existing title",
      channel: "Existing channel",
      durationSec: 321,
    });

    await runMaterialPipelineStep({
      materialId: "mat-1",
      pipelineVersion: "v1",
      step: "meta",
    });

    expect(mockContext.db.read(["materials", "mat-1", "_pipeline", "state:v1"])).toMatchObject({
      meta: {
        youtubeId: "yt-123",
        youtubeUrl: "https://youtu.be/yt-123",
        title: "Existing title",
        channel: "Existing channel",
        durationSec: 321,
      },
    });
  });

  it("stores fetched captions and refreshes top-level material metadata", async () => {
    mockContext.db.seed(["materials", "mat-1"], {
      youtubeId: "yt-123",
      youtubeUrl: "https://youtu.be/yt-123",
      title: "Original title",
      channel: "Original channel",
      durationSec: 100,
    });
    mockContext.db.seed(["materials", "mat-1", "_pipeline", "state:v2"], {
      meta: {
        youtubeId: "yt-123",
        youtubeUrl: "https://youtu.be/yt-123",
        title: "Original title",
        channel: "Original channel",
        durationSec: 100,
      },
      updatedAt: Timestamp.now(),
    });
    mockContext.fetchCaptions.mockResolvedValue({
      status: "fetched",
      source: "youtube_captions",
      cues: [{ startMs: 0, endMs: 1000, text: "Hello world" }],
      metadata: {
        title: "Fetched title",
        channel: "Fetched channel",
        durationSec: 222,
      },
    });

    await runMaterialPipelineStep({
      materialId: "mat-1",
      pipelineVersion: "v2",
      step: "captions",
    });

    expect(mockContext.fetchCaptions).toHaveBeenCalledWith({
      materialId: "mat-1",
      youtubeId: "yt-123",
      youtubeUrl: "https://youtu.be/yt-123",
    });
    expect(mockContext.db.read(["materials", "mat-1"])).toMatchObject({
      title: "Fetched title",
      channel: "Fetched channel",
      durationSec: 222,
    });
    expect(mockContext.db.read(["materials", "mat-1", "_pipeline", "state:v2"])).toMatchObject({
      captions: {
        status: "fetched",
        source: "youtube_captions",
      },
    });
  });

  it("replaces persisted segments during the format step", async () => {
    mockContext.db.seed(["materials", "mat-1", "segments", "old-1"], {
      startMs: 0,
      endMs: 400,
      text: "Old",
    });
    mockContext.db.seed(["materials", "mat-1", "_pipeline", "state:v3"], {
      captions: {
        status: "fetched",
        source: "youtube_captions",
        cues: [
          { startMs: 800, endMs: 1500, text: " Second  segment " },
          { startMs: 0, endMs: 500, text: "First segment" },
        ],
      },
      updatedAt: Timestamp.now(),
    });

    await runMaterialPipelineStep({
      materialId: "mat-1",
      pipelineVersion: "v3",
      step: "format",
    });

    const storedSegments = mockContext.db.list(["materials", "mat-1", "segments"]);
    const formattedSegments = storedSegments.map(({ value }) => value as FormattedSegment);

    expect(segmentTexts(formattedSegments)).toEqual(["First segment", "Second segment"]);
    expect(
      storedSegments.some(({ path }) => path[path.length - 1] === "old-1"),
    ).toBe(false);
    expect(mockContext.db.read(["materials", "mat-1", "_pipeline", "state:v3"])).toMatchObject({
      formattedSegmentCount: 2,
    });
  });
});
