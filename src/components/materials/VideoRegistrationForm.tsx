"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
      router.push(`/materials/loading?youtubeUrl=${encodeURIComponent(parsed.normalizedUrl)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "動画登録に失敗しました。");
    }
  }

  return (
    <section className="videoRegistrationSection">
      <form onSubmit={handleSubmit}>
        <label htmlFor="youtubeUrl" className="videoRegistrationLabel">
          Youtube URL
        </label>
        <input
          id="youtubeUrl"
          name="youtubeUrl"
          type="url"
          placeholder=""
          value={youtubeUrl}
          onChange={(event) => setYoutubeUrl(event.target.value)}
          disabled={submitState === "submitting"}
          readOnly={submitState === "submitting"}
          required
        />
        <button type="submit" disabled={submitState === "submitting"} className="primaryCtaButton">
          {submitState === "submitting" ? (
            <>
              登録中<span className="loadingDots">...</span>
            </>
          ) : (
            "動画を登録"
          )}
        </button>
      </form>
      {message ? <p className="videoRegistrationMessage">{message}</p> : null}
    </section>
  );
}
