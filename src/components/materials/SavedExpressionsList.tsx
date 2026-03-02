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
};

type SavedExpression = {
  expressionId: string;
  expression: string;
  meaning: string;
  exampleSentence: string;
};

type MaterialsApiResponse = {
  materials?: MaterialListItem[];
  error?: string;
};

type ExpressionsApiResponse = {
  expressions?: SavedExpression[];
  error?: string;
};

type ExpressionGroup = {
  materialId: string;
  title: string;
  channel: string;
  youtubeUrl: string;
  expressions: SavedExpression[];
};

function hasExpressionContent(expression: Partial<SavedExpression>): boolean {
  return Boolean(
    expression.expression?.trim() &&
      expression.meaning?.trim() &&
      expression.exampleSentence?.trim(),
  );
}

export function SavedExpressionsList() {
  const [groups, setGroups] = useState<ExpressionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const totalExpressions = groups.reduce((sum, group) => sum + group.expressions.length, 0);
  useEffect(() => {
    let mounted = true;

    async function loadSavedExpressions() {
      setLoading(true);
      setError("");

      try {
        const authHeaders = await buildAuthenticatedRequestHeaders();
        const materialsResponse = await fetch("/api/materials", {
          method: "GET",
          headers: authHeaders,
        });
        const materialsPayload = (await materialsResponse.json()) as MaterialsApiResponse;

        if (!materialsResponse.ok) {
          throw new Error(materialsPayload.error ?? "保存した表現の取得に失敗しました。");
        }

        const materials = materialsPayload.materials ?? [];
        const groupResults = await Promise.all(
          materials.map(async (material) => {
            const expressionsResponse = await fetch(`/api/materials/${material.materialId}/expressions`, {
              method: "GET",
              headers: authHeaders,
            });
            const expressionsPayload = (await expressionsResponse.json()) as ExpressionsApiResponse;

            if (!expressionsResponse.ok) {
              throw new Error(expressionsPayload.error ?? "保存した表現の取得に失敗しました。");
            }

            return {
              materialId: material.materialId,
              title: material.title || `YouTube動画 ${material.youtubeId}`,
              channel: material.channel || material.youtubeUrl,
              youtubeUrl: material.youtubeUrl,
              expressions: (expressionsPayload.expressions ?? []).filter((expression) =>
                hasExpressionContent(expression),
              ),
            };
          }),
        );

        if (!mounted) {
          return;
        }

        setGroups(groupResults.filter((group) => group.expressions.length > 0));
      } catch (loadError) {
        if (!mounted) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "保存した表現の取得に失敗しました。");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadSavedExpressions();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <section className="savedExpressionsShell">
        <div className="savedExpressionsHero">
        <div className="savedExpressionsHeroCopy">
          <h1>保存した表現</h1>
          <p>一覧を読み込んでいます...</p>
        </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="savedExpressionsShell">
        <div className="savedExpressionsHero">
        <div className="savedExpressionsHeroCopy">
          <h1>保存した表現</h1>
          <p className="videoRegistrationMessage">{error}</p>
        </div>
        </div>
      </section>
    );
  }

  return (
    <section className="savedExpressionsShell">
      <div className="savedExpressionsHero">
        <div className="savedExpressionsHeroCopy">
          <h1>保存した表現</h1>
          <p>動画ごとに保存した表現のみを復習できます</p>
        </div>
        <div className="savedExpressionsHeroStats" aria-label="保存した表現の概要">
          <div className="savedExpressionsStatCard">
            <span className="savedExpressionsStatLabel">保存数</span>
            <strong>{totalExpressions}</strong>
          </div>
          <div className="savedExpressionsStatCard">
            <span className="savedExpressionsStatLabel">動画数</span>
            <strong>{groups.length}</strong>
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="historyEmptyCard savedExpressionsEmptyCard">
          <h2>まだ保存した表現はありません</h2>
          <p>学習画面で表現を保存すると、ここに一覧表示されます。</p>
          <Link href="/" className="secondaryActionButton savedExpressionsStartLink">
            トップへ戻る
          </Link>
        </div>
      ) : (
        <div className="savedExpressionGroups">
          {groups.map((group) => (
            <article key={group.materialId} className="savedExpressionGroupCard">
              <div className="savedExpressionGroupHeader">
                <div>
                  <span className="savedExpressionGroupCount">{group.expressions.length} expressions</span>
                  <h2>{group.title}</h2>
                  <p>{group.channel}</p>
                </div>
                <Link href={`/materials/${group.materialId}`} className="secondaryActionButton savedExpressionGroupLink">
                  この動画を開く
                </Link>
              </div>
              <div className="savedExpressionGroupList">
                {group.expressions.map((expression) => (
                  <div key={expression.expressionId} className="savedExpressionGroupItem">
                    <dl className="savedExpressionDetails">
                      <div>
                        <dt>表現</dt>
                        <dd>{expression.expression}</dd>
                      </div>
                      <div>
                        <dt>意味</dt>
                        <dd>{expression.meaning}</dd>
                      </div>
                      <div>
                        <dt>例文</dt>
                        <dd>{expression.exampleSentence}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="learningBackLink savedExpressionsBackLink">
        <Link href="/">トップへ戻る</Link>
      </p>
    </section>
  );
}
