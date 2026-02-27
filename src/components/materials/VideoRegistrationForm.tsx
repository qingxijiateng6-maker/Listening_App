"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, doc, getDoc, getDocs, limit, query, setDoc, Timestamp, where } from "firebase/firestore";
import { signInAnonymouslyIfNeeded } from "@/lib/firebase/auth";
import { jobsCollection, materialsCollection } from "@/lib/firebase/firestore";
import { buildMaterialPipelineJobId } from "@/lib/jobs/idempotency";
import { MATERIAL_PIPELINE_VERSION } from "@/lib/constants";
import { isPubliclyAccessibleYouTubeVideo, parseYouTubeUrl } from "@/lib/youtube";
import type { Job, Material } from "@/types/domain";

type SubmitState = "idle" | "submitting";

export function VideoRegistrationForm() {
  const router = useRouter();
  const [youtubeUrl, setYoutubeUrl] = useState<string>("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string>("");

  const parsed = useMemo(() => parseYouTubeUrl(youtubeUrl), [youtubeUrl]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!parsed) {
      setMessage("YouTube公開動画のURL形式で入力してください。");
      return;
    }

    setSubmitState("submitting");
    try {
      await signInAnonymouslyIfNeeded();

      const isPublic = await isPubliclyAccessibleYouTubeVideo(parsed.youtubeId);
      if (!isPublic) {
        setMessage("公開動画URLのみ対応しています。");
        return;
      }

      const existingQuery = query(
        materialsCollection(),
        where("youtubeId", "==", parsed.youtubeId),
        where("pipelineVersion", "==", MATERIAL_PIPELINE_VERSION),
        limit(1),
      );
      const existingSnapshot = await getDocs(existingQuery);

      if (!existingSnapshot.empty) {
        const existingMaterialId = existingSnapshot.docs[0].id;
        setMessage("既存教材を再利用します。");
        router.push(`/materials/${existingMaterialId}`);
        return;
      }

      const now = Timestamp.now();
      const material: Material = {
        youtubeUrl: parsed.normalizedUrl,
        youtubeId: parsed.youtubeId,
        title: "",
        channel: "",
        durationSec: 0,
        status: "queued",
        pipelineVersion: MATERIAL_PIPELINE_VERSION,
        createdAt: now,
        updatedAt: now,
      };

      const materialRef = await addDoc(materialsCollection(), material);

      const job: Job = {
        type: "material_pipeline",
        materialId: materialRef.id,
        pipelineVersion: MATERIAL_PIPELINE_VERSION,
        status: "queued",
        step: "meta",
        attempt: 0,
        nextRunAt: now,
        lockedBy: "",
        lockedAt: now,
        errorCode: "",
        errorMessage: "",
        createdAt: now,
        updatedAt: now,
      };
      const jobId = buildMaterialPipelineJobId(materialRef.id, MATERIAL_PIPELINE_VERSION);
      const jobRef = doc(jobsCollection(), jobId);
      const jobSnapshot = await getDoc(jobRef);
      if (!jobSnapshot.exists()) {
        await setDoc(jobRef, job);
      }

      router.push(`/materials/${materialRef.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "動画登録に失敗しました。");
    } finally {
      setSubmitState("idle");
    }
  }

  return (
    <section>
      <h2>動画登録</h2>
      <form onSubmit={handleSubmit}>
        <label htmlFor="youtubeUrl">YouTube URL</label>
        <input
          id="youtubeUrl"
          name="youtubeUrl"
          type="url"
          placeholder="https://www.youtube.com/watch?v=..."
          value={youtubeUrl}
          onChange={(event) => setYoutubeUrl(event.target.value)}
          disabled={submitState === "submitting"}
          readOnly={submitState === "submitting"}
          required
        />
        <button type="submit" disabled={submitState === "submitting"}>
          {submitState === "submitting" ? (
            <>
              登録中<span className="loadingDots">...</span>
            </>
          ) : (
            "教材を作成"
          )}
        </button>
      </form>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
