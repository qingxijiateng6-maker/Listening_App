import { Timestamp } from "firebase-admin/firestore";
import { formatCaptionCues } from "../captions/parsers.js";
export class MaterialPipelineCancelledError extends Error {
    code = "material_pipeline_cancelled";
    constructor(materialId) {
        super(`Material pipeline cancelled for ${materialId}.`);
        this.name = "MaterialPipelineCancelledError";
    }
}
class MaterialPipelineStepError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = "MaterialPipelineStepError";
    }
}
function nowTs() {
    return Timestamp.now();
}
function stripUndefined(value) {
    if (Array.isArray(value)) {
        return value.map((item) => stripUndefined(item));
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value).flatMap(([key, entryValue]) => {
            if (entryValue === undefined) {
                return [];
            }
            return [[key, stripUndefined(entryValue)]];
        });
        return Object.fromEntries(entries);
    }
    return value;
}
export class MaterialPipelineService {
    db;
    captionProvider;
    config;
    logger;
    constructor(db, captionProvider, config, logger) {
        this.db = db;
        this.captionProvider = captionProvider;
        this.config = config;
        this.logger = logger;
    }
    stateRef(materialId, pipelineVersion) {
        return this.db
            .collection("materials")
            .doc(materialId)
            .collection("_pipeline")
            .doc(`state:${pipelineVersion}`);
    }
    async readState(materialId, pipelineVersion) {
        const snapshot = await this.stateRef(materialId, pipelineVersion).get();
        if (!snapshot.exists) {
            return { updatedAt: nowTs() };
        }
        const data = snapshot.data();
        return {
            meta: data.meta,
            captions: data.captions,
            formattedSegmentCount: data.formattedSegmentCount,
            updatedAt: data.updatedAt ?? nowTs(),
        };
    }
    async writeState(materialId, pipelineVersion, state) {
        await this.stateRef(materialId, pipelineVersion).set(stripUndefined({ ...state, updatedAt: nowTs() }), {
            merge: true,
        });
    }
    async readMaterial(materialId) {
        const snapshot = await this.db.collection("materials").doc(materialId).get();
        if (!snapshot.exists) {
            throw new Error(`Material not found: ${materialId}`);
        }
        const material = snapshot.data();
        if (!material.youtubeId || !material.youtubeUrl) {
            throw new Error(`Material ${materialId} is missing YouTube metadata.`);
        }
        return material;
    }
    async throwIfMaterialCancelled(materialId) {
        const snapshot = await this.db.collection("materials").doc(materialId).get();
        if (!snapshot.exists) {
            throw new Error(`Material not found: ${materialId}`);
        }
        const material = snapshot.data();
        if (material.status === "cancelled") {
            throw new MaterialPipelineCancelledError(materialId);
        }
    }
    async replaceSegments(materialId, segments) {
        const segmentsCollection = this.db.collection("materials").doc(materialId).collection("segments");
        const existingSnapshot = await segmentsCollection.get();
        let batch = this.db.batch();
        let operationCount = 0;
        const commitBatchIfNeeded = async (force = false) => {
            if (operationCount === 0 ||
                (!force && operationCount < this.config.materialPipelineBatchWriteLimit)) {
                return;
            }
            await batch.commit();
            batch = this.db.batch();
            operationCount = 0;
        };
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
    async runMeta(input) {
        await this.throwIfMaterialCancelled(input.materialId);
        const state = await this.readState(input.materialId, input.pipelineVersion);
        const material = await this.readMaterial(input.materialId);
        await this.throwIfMaterialCancelled(input.materialId);
        await this.writeState(input.materialId, input.pipelineVersion, {
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
    async runCaptions(input) {
        await this.throwIfMaterialCancelled(input.materialId);
        const state = await this.readState(input.materialId, input.pipelineVersion);
        const materialMeta = state.meta ??
            (() => {
                throw new Error(`Meta step must run before captions for material ${input.materialId}.`);
            })();
        const captions = await this.captionProvider.fetchCaptions({
            materialId: input.materialId,
            jobId: input.jobId,
            attempt: input.attempt,
            youtubeId: materialMeta.youtubeId,
            youtubeUrl: materialMeta.youtubeUrl,
        });
        await this.throwIfMaterialCancelled(input.materialId);
        if (captions.status !== "fetched") {
            await this.writeState(input.materialId, input.pipelineVersion, {
                ...state,
                captions,
                updatedAt: nowTs(),
            });
            const errorMessage = captions.reason === "captions_not_found"
                ? "この動画では字幕を取得できませんでした。字幕が利用できる公開動画で再度お試しください。"
                : captions.reason === "captions_provider_not_configured"
                    ? "字幕取得の設定に失敗しているため、字幕を準備できませんでした。"
                    : "字幕の取得に失敗しました。時間を置いて再度お試しください。";
            throw new MaterialPipelineStepError(errorMessage, captions.reason);
        }
        await this.db.collection("materials").doc(input.materialId).set({
            ...captions.materialPatch,
            updatedAt: nowTs(),
        }, { merge: true });
        await this.writeState(input.materialId, input.pipelineVersion, {
            ...state,
            captions,
            updatedAt: nowTs(),
        });
    }
    async runFormat(input) {
        await this.throwIfMaterialCancelled(input.materialId);
        const state = await this.readState(input.materialId, input.pipelineVersion);
        if (!state.captions) {
            throw new Error(`Captions step must run before format for material ${input.materialId}.`);
        }
        if (state.captions.status !== "fetched") {
            throw new MaterialPipelineStepError("字幕の取得が完了していないため、学習画面を準備できませんでした。", "formatted_segments_empty");
        }
        const formattedSegments = formatCaptionCues(state.captions.cues);
        if (formattedSegments.length === 0) {
            throw new MaterialPipelineStepError("字幕は取得できましたが、学習用の字幕データを生成できませんでした。", "formatted_segments_empty");
        }
        await this.replaceSegments(input.materialId, formattedSegments);
        await this.writeState(input.materialId, input.pipelineVersion, {
            ...state,
            formattedSegmentCount: formattedSegments.length,
            updatedAt: nowTs(),
        });
        this.logger.info("pipeline.format_completed", {
            materialId: input.materialId,
            jobId: input.jobId,
            attempt: input.attempt,
            subtitleLanguage: state.captions.metadata.subtitleLanguage,
            subtitleKind: state.captions.metadata.subtitleKind,
            ytDlpExitCode: 0,
            formattedSegmentCount: formattedSegments.length,
        });
    }
    async runStep(input) {
        switch (input.step) {
            case "meta":
                await this.runMeta(input);
                return;
            case "captions":
                await this.runCaptions(input);
                return;
            case "format":
                await this.runFormat(input);
                return;
            default:
                return;
        }
    }
}
