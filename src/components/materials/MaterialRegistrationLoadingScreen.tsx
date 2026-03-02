"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildAuthenticatedRequestHeaders } from "@/lib/firebase/auth";

type CreateMaterialResponse = {
  error?: string;
  materialId?: string;
};

export function MaterialRegistrationLoadingScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function registerMaterial() {
      const youtubeUrl = searchParams?.get("youtubeUrl")?.trim() ?? "";
      if (!youtubeUrl) {
        setError("YouTube公開動画のURL形式で入力してください。");
        return;
      }

      try {
        const authHeaders = await buildAuthenticatedRequestHeaders();
        const response = await fetch("/api/materials", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({ youtubeUrl }),
        });

        const payload = (await response.json()) as CreateMaterialResponse;
        if (!response.ok || !payload.materialId) {
          throw new Error(payload.error ?? "動画登録に失敗しました。");
        }

        if (!cancelled) {
          router.replace(`/materials/${payload.materialId}`);
        }
      } catch (registrationError) {
        if (!cancelled) {
          setError(registrationError instanceof Error ? registrationError.message : "動画登録に失敗しました。");
        }
      }
    }

    void registerMaterial();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  if (error) {
    return (
      <main>
        <section className="learningStateCard error">
          <h2>登録エラー</h2>
          <p>{error}</p>
          <p className="learningBackLink">
            <Link href="/">トップへ戻る</Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main>
      <section className="learningStateCard loading" aria-live="polite">
        <h2>読み込み中です...</h2>
        <p>動画を登録して、学習画面を準備しています。</p>
      </section>
    </main>
  );
}
