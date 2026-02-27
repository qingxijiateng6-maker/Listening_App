## 1. 背景・目的

### 1.1 背景

英語学習者（特にC1〜C2レベル）は、以下の課題を抱えている。

- 英語圏のYouTube動画（ニュース・解説・講演など）は質が高いが **学習素材として使うには手間が大きい**
- 「聞き取れなかった表現」「気になる言い回し」を **その場ですぐ確認できない**
- 実際に使える表現（能動語彙）に落とし込む仕組みが弱い
- 単語帳・教材は「実用性」「文脈」「再利用性」が低い

### 1.2 目的

本プロダクトは、**YouTube動画を入力するだけで**

- リスニング学習に最適化された教材を自動生成し
- 視聴中に表現の意味を即座に理解でき
- 本当に実用的な表現だけを高品質に抽出し
- それらを **能動語彙として定着**させる
    
    ことを目的とする。
    

---

## 2. プロダクト概要

### 2.1 種別

- **Webアプリケーション**
- **フロント/サーバー：Vercel**
- **認証：Firebase Authentication（Anonymous）**
- **DB：Firestore**
- インストール不要、URL入力のみ

### 2.2 コアコンセプト

> 「YouTube動画を、C1/C2向けの“実戦教材”に自動変換する」
> 

### 2.3 特徴（要約）

- YouTube URL入力 → 自動教材生成（非同期）
- 視聴中、字幕タップで **即・意味理解**
- 厳選された「重要表現」だけに
    - 意味
    - 動画内使用箇所（該当シーン再生）
    - 場面想定例文
- 表現選定は **多段アルゴリズム＋品質ゲート**
- 完全匿名利用

---

## 3. 想定ユーザー・前提条件

### 3.1 想定ユーザー

- 英語レベル：**CEFR C1〜C2**
- 主目的：**リスニング強化**
- 属性：
    - 社会人
    - 英語学習経験は豊富
    - 教材の質に厳しい

### 3.2 ユーザー前提

- 字幕は欲しい
- 単語レベルの説明より **表現・運用・ニュアンス**重視
- 「簡単すぎる表現」は不要
- 専門ジャンルは限定しない

---

## 4. 学習体験・UX要件

### 4.1 基本学習フロー

1. ユーザーが **YouTube動画URL** を入力
2. システムが非同期で教材生成（ジョブ化）
3. 学習画面で動画を再生
4. 字幕を見ながら視聴
5. わからない表現をタップ
6. 重要表現を保存・確認
7. 能動語彙として定着

### 4.2 視聴中UX（最重要）

### 4.2.1 字幕表示

- タイムスタンプ付き字幕
- 再生位置に追従
- 文単位で表示

### 4.2.2 字幕タップ挙動（2系統）

| 対象 | 表示内容 |
| --- | --- |
| 任意の語・フレーズ | **意味のみ（日本語）** |
| 重要表現 | 意味 + 例文 + 該当シーン再生 |

※ 例文は **重要表現のみ** に限定

### 4.3 重要表現のUX

各重要表現には必ず以下が存在する：

1. 英語表現
2. 日本語の短い意味
3. 動画内の使用箇所（タイムスタンプ再生）
4. **場面想定例文（1文）**（動画文脈に依存しない）

### 4.4 UX非機能要件

- タップ後の意味表示：**体感1秒以内**
- 重要表現カード表示：**即時（DB参照のみ）**
- 学習中にLLMが走らない設計（教材生成時に前計算）

---

## 5. 機能要件（ユーザー視点）

### 5.1 動画登録

- YouTube公開動画URLのみ対応
- 非公開・限定公開は非対応
- 同一URLは教材キャッシュを再利用

### 5.2 教材生成

- 字幕があれば優先利用
- なければASRで文字起こし
- 文分割・句読点補正
- 重要表現を自動抽出

### 5.3 学習画面

- 動画再生（YouTube IFrame API）
- 字幕一覧（タップ対象）
- タップ辞書機能
- 重要表現一覧

### 5.4 保存・学習状態

- 匿名ユーザーでも表現保存可
- 保存／除外／習得ステータス
- 復習機能はMVP後拡張

---

## 6. 技術要件（アーキテクチャ全体：Firebase + Vercel のみ）

## 6.1 全体構成（確定）

### 採用技術スタック

| 領域 | 技術 |
| --- | --- |
| フロントエンド | Web（Next.js想定、SSR/SPAは不問） |
| デプロイ/ホスティング | **Vercel** |
| API/サーバー実行 | **Vercel Functions（Serverless/Edge/Background を用途により選択）** |
| 認証 | **Firebase Anonymous Authentication** |
| DB | **Firestore** |
| 動画再生 | YouTube IFrame Player API |
| 非同期処理 | **Firestoreジョブキュー + Vercel Cron + Vercel Worker API** |
| NLP | spaCy（POS/NER）※Vercel実行制約に合わせて分割実行 |
| 生成AI | OpenAI API（Provider抽象化） |

### 設計原則

- 学習中に重い処理を走らせない
- 教材生成は完全非同期（ジョブ化）
- 重要表現は事前生成
- タップ辞書はオンデマンド＋動画固有キャッシュ
- 生成AIは多段構成（品質担保）

---

## 6.2 処理責務の分離

| 処理 | 担当 |
| --- | --- |
| URL登録・画面表示 | Vercel（フロント） |
| 教材生成（重処理） | Vercel Worker API（非同期） |
| キュー管理 | Firestore（jobsコレクション） |
| キック（定期実行） | Vercel Cron |
| スコアリング・評価 | Vercel Worker API |
| 辞書意味生成（オンデマンド） | Vercel API |
| 状態管理 | Firestore |
| 認証/UID | Firebase Auth |

---

## 6.3 非同期設計（Cloud Tasks代替）

### 方式（確定）

- Firestoreにジョブを積む（キュー）
- Vercel Cronが定期的にワーカーAPIを叩き、queuedをprocessingへロックして処理
- 失敗時は指数バックオフで再実行（nextRunAt）

### 要件（必須）

- **冪等性**：materialId + pipelineVersion で同一処理を重複生成しない
- **多重実行防止**：Firestoreトランザクションでロック
- **再開性**：長時間処理はステップ分割し、途中結果を保存して続行可能にする

---

## 7. データ設計（Firestore）

## 7.1 materials（動画教材）

```
materials/{materialId}{
  youtubeUrl: string
  youtubeId: string
  title: string
  channel: string
  durationSec: number

  status:"queued" |"processing" |"ready" |"failed"
  pipelineVersion: string

  createdAt: timestamp
  updatedAt: timestamp
}
```

### status遷移

- queued → processing → ready
- 恒久エラー → failed

---

## 7.2 segments（字幕セグメント）

```
materials/{materialId}/segments/{segmentId}{
  startMs: number
  endMs: number
  text: string
}
```

- 文単位、タイムスタンプ必須、UIタップ対象

---

## 7.3 expressions（重要表現）

```
materials/{materialId}/expressions/{expressionId}{
  expressionText: string

  scoreFinal: number
  axisScores:{
    utility: number
    portability: number
    naturalness: number
    c1_value: number
    context_robustness: number
  }

  meaningJa: string
  reasonShort: string
  scenarioExample: string

  flagsFinal: string[]
  occurrences:[
    { startMs: number, endMs: number, segmentId: string }
  ]

  createdAt: timestamp
}
```

- `scenarioExample` は重要表現のみ必須

---

## 7.4 glossary（字幕タップ意味キャッシュ：動画固有）

```
materials/{materialId}/glossary/{hash(surfaceText)}{
  surfaceText: string
  meaningJa: string
  createdAt: timestamp
}
```

- 初回タップ時に生成、以降は即時表示（動画固有キャッシュ）

---

## 7.5 userExpressions（匿名ユーザー学習状態）

```
users/{uid}/expressions/{expressionId}{
  status:"saved" |"ignored" |"mastered"
  updatedAt: timestamp
}
```

- UIDはFirebase匿名認証
- 個人情報は保持しない

---

## 7.6 jobs（非同期ジョブキュー：追加・必須）

※Cloud Tasks代替のため、本改訂で追加（機能は変えない）

```
jobs/{jobId}{
  type:"material_pipeline" | "glossary_generate"
  materialId: string
  pipelineVersion: string

  status:"queued"|"processing"|"done"|"failed"
  step:"meta"|"captions"|"asr"|"format"|"extract"|"filter"|"score"|"reeval"|"examples"|"persist"
  attempt: number
  nextRunAt: timestamp

  lockedBy: string
  lockedAt: timestamp

  errorCode: string
  errorMessage: string

  createdAt: timestamp
  updatedAt: timestamp
}
```

### ロック仕様（必須）

- `status=queued` かつ `nextRunAt <= now` のものだけ取得
- Firestoreトランザクションで `status=processing` と `lockedAt` を同時更新
- `lockedAt` が一定時間（例：10分）超過のprocessingは回収して再キュー可能

---

## 8. 非同期処理要件（Vercel + Firestore）

## 8.1 キュー仕様

- キュー方式：**Firestore jobs**
- 実行方式：**Vercel Cron → Worker API**
- Payload相当：jobsドキュメントに内包（materialId, pipelineVersion）

## 8.2 パイプライン実行順（機能同一・確定）

1. YouTubeメタデータ取得
2. 字幕取得（あれば）
3. ASR（字幕なし or 低品質）
4. 字幕整形（文分割・補正）
5. 表現候補抽出
6. フィルタ（NER+POS）
7. スコアリング（5軸）
8. ペナルティ・減点適用
9. re-eval（accept / revise / reject）
10. 閾値採用（≥75）
11. 採用表現のみ例文生成
12. Firestore保存
13. material.status=ready

## 8.3 冪等性・再実行耐性

- materialId + pipelineVersion で冪等
- ステップ分割により中断→再開可能
- 途中失敗はattempt増加、nextRunAtを未来にして再試行

---

## 9. セキュリティ・匿名性・運用

### 9.1 匿名性ポリシー

- Firebase Anonymous Auth
- メール・名前・IP保存なし
- 学習履歴はUIDにのみ紐付け

### 9.2 公開運用上の配慮

- 不適切表現は re-eval で reject
- `unsafe_or_inappropriate` flag で強制除外
- YouTube規約に沿った再生方式（IFrame）

### 9.3 ログ・監視（最小構成）

- ジョブ成功率（jobs.status集計）
- 生成時間（jobsのcreatedAt→done）
- 表現採用数（統計のみ）
- 個人行動ログは保存しない

---

## 10. 実用表現抽出・選定アルゴリズム（完全仕様）

※以下は機能不変のため原仕様を維持（文言のみ整理）

### 10.1 基本方針

- 抽出対象：1語〜8語（価値があれば1語も可）
- 採用方針：固定数なし、`score >= threshold` を全件採用
- 品質担保：ルール＋スコア＋再評価の多段構成

### 10.2 抽出パイプライン全体像

```
字幕セグメント
   ↓
候補抽出（LLM + ルール）
   ↓
フィルタ（NER + POS）
   ↓
スコアリング（5軸）
   ↓
ペナルティ・補正
   ↓
re-eval（accept / revise / reject）
   ↓
threshold判定（>=75）
   ↓
重要表現として確定
   ↓
場面想定例文生成
```

---

## 11. フィルタ規則（NER + POS：確定仕様）

（あなたの原文仕様を維持：Hard Reject / Soft Flags / 例外救済 / 1語候補）

---

## 12. スコアリング設計（0–100）

（あなたの原文仕様を維持：5軸、flags補正、最終ペナルティ、threshold=75）

---

## 13. LLM連携仕様（確定）

- LLMは **OpenAI API** を使用（Provider抽象化は維持）
- baseAxisScores / re-eval / scenarioExample のJSON仕様は原文維持

---

## 14. 受け入れ基準（Acceptance Criteria）

- URL入力 → 教材生成される（非同期）
- 字幕タップ → 意味のみ即表示
- 重要表現 →
    - 意味
    - 動画内使用箇所
    - 場面想定例文
- 重要表現は threshold以上を全件採用
- 匿名で保存・再訪可能
- 不適切表現は保存されない

---

## 15. MVP範囲と将来拡張

（原文維持）

---

# 付記（重要）：Firebase + Vercel完結に伴う「非機能上の必須条件」

- **重い処理（ASR / spaCy / 多段LLM）はジョブをステップ分割**し、Vercel実行制約内で継続実行できること
- ジョブロックは **Firestoreトランザクション**で担保すること
- glossaryは **動画固有キャッシュ**で「1秒以内UX」を守ること