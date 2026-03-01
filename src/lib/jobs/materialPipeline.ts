import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
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
  title?: string;
  channel?: string;
  durationSec?: number;
};

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

async function replaceSegments(materialId: string, segments: FormattedSegment[]): Promise<void> {
  const db = getAdminDb();
  const segmentsCollection = db.collection("materials").doc(materialId).collection("segments");
  const existingSnapshot = await segmentsCollection.get();
  const batch = db.batch();

  existingSnapshot.docs.forEach((docSnapshot) => {
    batch.delete(docSnapshot.ref);
  });

  segments.forEach((segment) => {
    batch.set(segmentsCollection.doc(segment.id), {
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    });
  });

  await batch.commit();
}

async function runMeta(materialId: string, pipelineVersion: string): Promise<void> {
  const state = await readState(materialId, pipelineVersion);
  const material = await readMaterial(materialId);

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

  if (captions.status !== "fetched") {
    throw new Error(captions.message);
  }

  await getAdminDb().collection("materials").doc(materialId).set(
    {
      title: captions.metadata?.title ?? materialMeta.title,
      channel: captions.metadata?.channel ?? materialMeta.channel,
      durationSec: captions.metadata?.durationSec ?? materialMeta.durationSec,
      updatedAt: nowTs(),
    },
    { merge: true },
  );

  await writeState(materialId, pipelineVersion, {
    ...state,
    captions,
    updatedAt: nowTs(),
  });
}

async function runFormat(materialId: string, pipelineVersion: string): Promise<void> {
  const state = await readState(materialId, pipelineVersion);
  if (!state.captions) {
    throw new Error(`Captions step must run before format for material ${materialId}.`);
  }

  const formattedSegments =
    state.captions.status === "fetched" ? formatCaptionCues(state.captions.cues) : [];

  await replaceSegments(materialId, formattedSegments);
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
