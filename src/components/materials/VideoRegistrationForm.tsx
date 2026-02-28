"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signInAnonymouslyIfNeeded } from "@/lib/firebase/auth";
import { parseYouTubeUrl } from "@/lib/youtube";

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
      const response = await fetch("/api/materials", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ youtubeUrl: parsed.normalizedUrl }),
      });

      const payload = (await response.json()) as {
        error?: string;
        materialId?: string;
        reused?: boolean;
      };

      if (!response.ok || !payload.materialId) {
        throw new Error(payload.error ?? "動画登録に失敗しました。");
      }

      if (payload.reused) {
        setMessage("既存教材を再利用します。");
      }

      router.push(`/materials/${payload.materialId}`);
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
