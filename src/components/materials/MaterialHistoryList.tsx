"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buildAuthenticatedRequestHeaders } from "@/lib/firebase/auth";

type MaterialListItem = {
  materialId: string;
  youtubeId: string;
  youtubeUrl: string;
  title: string;
  channel: string;
  status: "queued" | "processing" | "ready" | "failed";
  pipelineVersion: string;
  updatedAt: string | null;
};

type MaterialsApiResponse = {
  materials?: MaterialListItem[];
  error?: string;
};

function formatUpdatedAt(value: string | null): string {
  if (!value) {
    return "日時未設定";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "日時未設定";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function MaterialHistoryList() {
  const [materials, setMaterials] = useState<MaterialListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingMaterialId, setDeletingMaterialId] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadMaterials() {
      setLoading(true);
      setError("");

      try {
        const authHeaders = await buildAuthenticatedRequestHeaders();
        const response = await fetch("/api/materials", {
          method: "GET",
          headers: authHeaders,
        });
        const payload = (await response.json()) as MaterialsApiResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "登録した動画の取得に失敗しました。");
        }

        if (!mounted) {
          return;
        }

        setMaterials(payload.materials ?? []);
      } catch (loadError) {
        if (!mounted) {
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : "登録した動画の取得に失敗しました。",
        );
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadMaterials();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleDeleteMaterial(materialId: string): Promise<void> {
    setDeletingMaterialId(materialId);
    setError("");

    try {
      const authHeaders = await buildAuthenticatedRequestHeaders();
      const response = await fetch(`/api/materials/${materialId}`, {
        method: "DELETE",
        headers: authHeaders,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as MaterialsApiResponse | null;
        throw new Error(payload?.error ?? "登録した動画の削除に失敗しました。");
      }

      setMaterials((current) => current.filter((material) => material.materialId !== materialId));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "登録した動画の削除に失敗しました。",
      );
    } finally {
      setDeletingMaterialId("");
    }
  }

  if (loading) {
    return (
      <section className="historyListSection">
        <h1>登録した動画</h1>
        <p>一覧を読み込んでいます...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="historyListSection">
        <h1>登録した動画</h1>
        <p className="videoRegistrationMessage">{error}</p>
      </section>
    );
  }

  return (
    <section className="historyListSection">
      <div className="historyListHeader">
        <div>
          <h1>登録した動画</h1>
          <p>一覧から選ぶと、保存済みの学習画面をそのまま開けます。</p>
        </div>
      </div>
      {materials.length === 0 ? (
        <div className="historyEmptyCard">
          <h2>まだ動画がありません</h2>
          <p>トップページから YouTube URL を登録してください。</p>
        </div>
      ) : (
        <div className="historyListGrid">
          {materials.map((material) => (
            <article key={material.materialId} className="historyListCard">
              <Link
                href={`/materials/${material.materialId}`}
                className="historyListCardLink"
              >
                <span className="historyListCardStatus">{material.status}</span>
                <h2>{material.title || `YouTube動画 ${material.youtubeId}`}</h2>
                <p>{material.channel || material.youtubeUrl}</p>
                <span className="historyListCardMeta">
                  最終更新: {formatUpdatedAt(material.updatedAt)}
                </span>
              </Link>
              <button
                type="button"
                className="historyListDeleteButton"
                onClick={() => {
                  void handleDeleteMaterial(material.materialId);
                }}
                disabled={deletingMaterialId === material.materialId}
              >
                {deletingMaterialId === material.materialId ? "削除中..." : "削除"}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
