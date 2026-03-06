import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { MATERIAL_PIPELINE_BATCH_WRITE_LIMIT } from "@/lib/constants";
import {
  formatCaptionCues,
  getMaterialPipelineCaptionProvider,
  type CaptionFetchResult,
  type FormattedSegment,
} from "@/lib/jobs/materialPipelineCaptions";
import type { JobStep } from "@/types/domain";

type PipelineState = {
  meta?: {
    youtubeId: string;
    youtubeUrl: string;
    title: string;
    channel: string;
    durationSec: number;
  };
  captions?: CaptionFetchResult;
  formattedSegmentCount?: number;
  updatedAt: Timestamp;
};

type MaterialRecord = {
  youtubeId: string;
  youtubeUrl: string;
  status?: "queued" | "processing" | "ready" | "failed" | "cancelled";
  title?: string;
  channel?: string;
  durationSec?: number;
};

export class MaterialPipelineCancelledError extends Error {
  readonly code = "material_pipeline_cancelled";

  constructor(materialId: string) {
    super(`Material pipeline cancelled for ${materialId}.`);
    this.name = "MaterialPipelineCancelledError";
  }
}

export function isMaterialPipelineCancelledError(error: unknown): error is MaterialPipelineCancelledError {
  return error instanceof MaterialPipelineCancelledError;
}

class MaterialPipelineStepError extends Error {
  constructor(
    message: string,
    readonly code:
      | "captions_not_found"
      | "captions_provider_not_configured"
      | "captions_provider_failed"
      | "formatted_segments_empty",
  ) {
    super(message);
    this.name = "MaterialPipelineStepError";
  }
}

function nowTs(): Timestamp {
  return Timestamp.now();
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).flatMap(([key, entryValue]) => {
      if (entryValue === undefined) {
        return [];
      }
      return [[key, stripUndefined(entryValue)]];
    });
    return Object.fromEntries(entries) as T;
  }

  return value;
}

function stateRef(materialId: string, pipelineVersion: string) {
  return getAdminDb()
    .collection("materials")
    .doc(materialId)
    .collection("_pipeline")
    .doc(`state:${pipelineVersion}`);
}

async function readState(materialId: string, pipelineVersion: string): Promise<PipelineState> {
  const snapshot = await stateRef(materialId, pipelineVersion).get();
  if (!snapshot.exists) {
    return { updatedAt: nowTs() };
  }
  const data = snapshot.data() as PipelineState;
  return {
    meta: data.meta,
    captions: data.captions,
    formattedSegmentCount: data.formattedSegmentCount,
    updatedAt: data.updatedAt ?? nowTs(),
  };
}

async function writeState(materialId: string, pipelineVersion: string, state: PipelineState): Promise<void> {
  await stateRef(materialId, pipelineVersion).set(stripUndefined({ ...state, updatedAt: nowTs() }), {
    merge: true,
  });
}

async function readMaterial(materialId: string): Promise<MaterialRecord> {
  const snapshot = await getAdminDb().collection("materials").doc(materialId).get();
  if (!snapshot.exists) {
    throw new Error(`Material not found: ${materialId}`);
  }

  const material = snapshot.data() as MaterialRecord;
  if (!material.youtubeId || !material.youtubeUrl) {
    throw new Error(`Material ${materialId} is missing YouTube metadata.`);
  }

  return material;
}

async function throwIfMaterialCancelled(materialId: string): Promise<void> {
  const snapshot = await getAdminDb().collection("materials").doc(materialId).get();
  if (!snapshot.exists) {
    throw new Error(`Material not found: ${materialId}`);
  }

  const material = snapshot.data() as MaterialRecord;
  if (material.status === "cancelled") {
    throw new MaterialPipelineCancelledError(materialId);
  }
}

async function replaceSegments(materialId: string, segments: FormattedSegment[]): Promise<void> {
  const db = getAdminDb();
  const segmentsCollection = db.collection("materials").doc(materialId).collection("segments");
  const existingSnapshot = await segmentsCollection.get();
  let batch = db.batch();
  let operationCount = 0;

  async function commitBatchIfNeeded(force = false) {
    if (operationCount === 0 || (!force && operationCount < MATERIAL_PIPELINE_BATCH_WRITE_LIMIT)) {
      return;
    }

    await batch.commit();
    batch = db.batch();
    operationCount = 0;
  }

  for (const docSnapshot of existingSnapshot.docs) {
    batch.delete(docSnapshot.ref);
    operationCount += 1;
    await commitBatchIfNeeded();
  }

  for (const segment of segments) {
    batch.set(segmentsCollection.doc(segment.id), {
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    });
    operationCount += 1;
    await commitBatchIfNeeded();
  }

  await commitBatchIfNeeded(true);
}

async function runMeta(materialId: string, pipelineVersion: string): Promise<void> {
  await throwIfMaterialCancelled(materialId);
  const state = await readState(materialId, pipelineVersion);
  const material = await readMaterial(materialId);
  await throwIfMaterialCancelled(materialId);

  await writeState(materialId, pipelineVersion, {
    ...state,
    meta: {
      youtubeId: material.youtubeId,
      youtubeUrl: material.youtubeUrl,
      title: material.title ?? "",
      channel: material.channel ?? "",
      durationSec: material.durationSec ?? 0,
    },
    updatedAt: nowTs(),
  });
}

async function runCaptions(materialId: string, pipelineVersion: string): Promise<void> {
  await throwIfMaterialCancelled(materialId);
  const state = await readState(materialId, pipelineVersion);
  const materialMeta =
    state.meta ??
    (() => {
      throw new Error(`Meta step must run before captions for material ${materialId}.`);
    })();
  const provider = getMaterialPipelineCaptionProvider();
  const captions = await provider.fetchCaptions({
    materialId,
    youtubeId: materialMeta.youtubeId,
    youtubeUrl: materialMeta.youtubeUrl,
  });
  await throwIfMaterialCancelled(materialId);

  if (captions.status !== "fetched") {
    await writeState(materialId, pipelineVersion, {
      ...state,
      captions,
      updatedAt: nowTs(),
    });

    const errorMessage =
      captions.reason === "captions_not_found"
        ? "この動画では字幕を取得できませんでした。字幕が利用できる公開動画で再度お試しください。"
        : captions.reason === "captions_provider_not_configured"
          ? "字幕取得の設定に失敗しているため、字幕を準備できませんでした。"
          : "字幕の取得に失敗しました。時間を置いて再度お試しください。";
    throw new MaterialPipelineStepError(errorMessage, captions.reason);
  }

  await throwIfMaterialCancelled(materialId);
  await getAdminDb().collection("materials").doc(materialId).set(
    {
      title: captions.metadata?.title ?? materialMeta.title,
      channel: captions.metadata?.channel ?? materialMeta.channel,
      durationSec: captions.metadata?.durationSec ?? materialMeta.durationSec,
      updatedAt: nowTs(),
    },
    { merge: true },
  );

  await throwIfMaterialCancelled(materialId);
  await writeState(materialId, pipelineVersion, {
    ...state,
    captions,
    updatedAt: nowTs(),
  });
}

async function runFormat(materialId: string, pipelineVersion: string): Promise<void> {
  await throwIfMaterialCancelled(materialId);
  const state = await readState(materialId, pipelineVersion);
  if (!state.captions) {
    throw new Error(`Captions step must run before format for material ${materialId}.`);
  }
  if (state.captions.status !== "fetched") {
    throw new MaterialPipelineStepError(
      "字幕の取得が完了していないため、学習画面を準備できませんでした。",
      "formatted_segments_empty",
    );
  }

  const formattedSegments = formatCaptionCues(state.captions.cues);
  if (formattedSegments.length === 0) {
    throw new MaterialPipelineStepError(
      "字幕は取得できましたが、学習用の字幕データを生成できませんでした。",
      "formatted_segments_empty",
    );
  }

  await throwIfMaterialCancelled(materialId);
  await replaceSegments(materialId, formattedSegments);
  await throwIfMaterialCancelled(materialId);
  await writeState(materialId, pipelineVersion, {
    ...state,
    formattedSegmentCount: formattedSegments.length,
    updatedAt: nowTs(),
  });
}

export async function runMaterialPipelineStep(input: {
  materialId: string;
  pipelineVersion: string;
  step: JobStep;
}): Promise<void> {
  switch (input.step) {
    case "meta":
      await runMeta(input.materialId, input.pipelineVersion);
      return;
    case "captions":
      await runCaptions(input.materialId, input.pipelineVersion);
      return;
    case "format":
      await runFormat(input.materialId, input.pipelineVersion);
      return;
    default:
      return;
  }
}
