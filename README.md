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

## 8.4 jobs状態遷移（lock/retry/idempotency）

### 状態遷移（`jobs.status`）

- `queued` → `processing`
  - 条件：`nextRunAt <= now`
  - 実行：Firestoreトランザクションで `status=processing` / `lockedBy` / `lockedAt` を同時更新
- `processing` → `done`
  - 条件：全step成功、成果物永続化完了
- `processing` → `queued`
  - 条件：リトライ可能エラー（ネットワーク一時障害、APIレート制限など）
  - 実行：`attempt += 1`、指数バックオフで `nextRunAt` を更新
- `processing` → `failed`
  - 条件：非リトライエラー、または最大試行回数超過
- `processing(stale lock)` → `queued`
  - 条件：`lockedAt` がロックTTL（例: 10分）を超過
  - 実行：回収ワーカーがロックを解除して再キュー

### 冪等性（必須）

- 一意キー：`materialId + pipelineVersion + type`
- `done` 済みの同一キーjobが存在する場合は新規処理を開始しない
- `persist` stepはupsertで実装し、重複書き込み時も同一結果を保証する

## 8.5 想定レースコンディションと対策

- ケース1：複数ワーカーが同じ`queued` jobを同時に取得する
  - 対策：`lockDueJobs`でFirestoreトランザクションを使い、`status=queued`と`nextRunAt<=now`を再検証した上で`processing`へ更新
- ケース2：同一`materialId + pipelineVersion`の重複jobが作成される
  - 対策：jobIdを`material_pipeline:{materialId}:{pipelineVersion}`の固定IDにし、作成トランザクションで重複作成を拒否
- ケース3：同一キーjobが別docで残存しており、並列実行される
  - 対策：ロック時に同一キーの`processing/done`を照会し、`done`があれば即スキップ、`processing`があれば再キュー
- ケース4：ワーカー異常終了で`processing`のまま取り残される
  - 対策：`lockedAt`がTTL超過のjobを定期回収し、`queued`に戻して再実行
- ケース5：再試行が集中して同時刻に再突入する
  - 対策：`attempt`ベースの指数バックオフで`nextRunAt`を後ろ倒しし、再実行を分散

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

## 15. API一覧（責務・入力・出力・認可）

| API | 責務 | 入力 | 出力 | 認可 |
| --- | --- | --- | --- | --- |
| `POST /api/materials` | 動画教材の登録、重複判定、生成job投入 | `{ youtubeUrl }` | `{ materialId, status }` | Firebase匿名ログイン必須（UID） |
| `GET /api/materials/:materialId` | 教材メタ情報・生成状態の取得 | `materialId(path)` | `{ material, status }` | 公開教材は匿名可、非公開設定導入後は所有者UID確認 |
| `GET /api/materials/:materialId/segments` | 字幕セグメント取得 | `materialId(path)` | `{ segments[] }` | 匿名可 |
| `GET /api/materials/:materialId/expressions` | 重要表現一覧取得 | `materialId(path)` | `{ expressions[] }` | 匿名可 |
| `POST /api/materials/:materialId/glossary` | 字幕タップ語の意味を生成/キャッシュ | `{ surfaceText }` | `{ surfaceText, meaningJa }` | 匿名可（レート制御あり） |
| `PUT /api/users/me/expressions/:expressionId` | 学習状態（saved/ignored/mastered）を更新 | `{ status }` | `{ expressionId, status, updatedAt }` | Firebase匿名ログイン必須（`request.auth.uid`一致） |
| `GET /api/users/me/expressions` | 自分の保存表現状態を取得 | なし | `{ items[] }` | Firebase匿名ログイン必須 |
| `POST /api/worker/jobs/dispatch` | Cronから起動され、実行可能jobをロックして処理開始 | `cron secret header` | `{ picked, processed, failed }` | サーバー間認証（Vercel Cron Secret） |
| `POST /api/worker/jobs/recover-stale` | stale lock jobの回収 | `cron secret header` | `{ recovered }` | サーバー間認証（Vercel Cron Secret） |

### 15.1 API実装状況（2026-02-27時点）

- 実装済み:
  - `POST /api/materials/:materialId/glossary`
  - `GET /api/cron/jobs`
  - `POST /api/jobs/dispatch`
  - `POST /api/worker/material-pipeline`
  - `POST /api/worker/jobs/dispatch`
  - `POST /api/worker/jobs/recover-stale`
- 未実装（MVP残タスク）:
  - `POST /api/materials`
  - `GET /api/materials/:materialId`
  - `GET /api/materials/:materialId/segments`
  - `GET /api/materials/:materialId/expressions`
  - `PUT /api/users/me/expressions/:expressionId`
  - `GET /api/users/me/expressions`

---

## 16. MVP範囲と将来拡張

### 16.1 MVP対象（実装する）

- YouTube URL登録と非同期教材生成
- 字幕タップ時の意味表示（動画固有glossaryキャッシュ）
- 重要表現の提示（意味・使用箇所・場面想定例文）
- 匿名ユーザーでの保存状態更新（saved/ignored/mastered）
- Firestore jobs + Vercel Cron/Workerによる再実行可能パイプライン

### 16.2 MVP対象外（実装しない）

- SSO/メール認証/アカウント統合（匿名認証のみ）
- 複数言語UI（日本語UIのみ）
- 復習SRS、出題アルゴリズム、通知機能
- SNS共有、ランキング、コメント等のコミュニティ機能
- ネイティブアプリ（iOS/Android）とオフライン再生
- YouTube以外の動画ソース（Podcast, Vimeo等）
- 管理画面での手動キュレーション編集

### 16.3 境界条件（曖昧化防止）

- 「教材生成品質の改善」はMVP内。ただし「新規学習モード追加（シャドーイング特化UI等）」はMVP外
- 「匿名UIDでのデータ保持」はMVP内。ただし「端末間アカウント引き継ぎ」はMVP外
- 「ジョブの失敗再試行」はMVP内。ただし「運用ダッシュボードの高度分析」はMVP外

---

# 付記（重要）：Firebase + Vercel完結に伴う「非機能上の必須条件」

- **重い処理（ASR / spaCy / 多段LLM）はジョブをステップ分割**し、Vercel実行制約内で継続実行できること
- ジョブロックは **Firestoreトランザクション**で担保すること
- glossaryは **動画固有キャッシュ**で「1秒以内UX」を守ること

---

## 17. ローカル起動手順（開発用）

1. 依存パッケージをインストール

```bash
npm install
```

2. 環境変数を設定（`.env.example` を `.env.local` にコピーして値を入力）

```bash
cp .env.example .env.local
```

3. 開発サーバーを起動

```bash
npm run dev
```

4. 動作確認

- `http://localhost:3000` を開く
- 画面に `Firebase Anonymous Auth: initialized` が表示される
- 画面に `Firestore: ready` が表示される

---

## 18. glossary レイテンシ計測方法

- API側計測：`/api/materials/:materialId/glossary` で `startedAt=Date.now()` からレスポンス直前までを `latencyMs` として返却
- クライアント側計測：`performance.now()` で要求開始からJSON受信完了までを `total` として表示
- 表示形式：`source: firestore-cache/generated / api: XXXms / total: YYYms`
- UX保護：クライアントは `900ms` タイムアウト（`AbortController`）を設定し、超過時は即時に再試行案内を表示

---

## 19. 重要表現パイプライン サンプル入出力JSON

### 19.1 extract入力（segments）

```json
{
  "materialId": "mat_123",
  "segments": [
    {
      "id": "seg_1",
      "startMs": 1200,
      "endMs": 4200,
      "text": "We need to align on the long term strategy."
    }
  ]
}
```

---

## 20. セットアップ手順

1. Node.js 20系以上をインストール
2. 依存パッケージをインストール

```bash
npm install
```

3. 環境変数を作成（`.env.example` を `.env.local` にコピー）

```bash
cp .env.example .env.local
```

4. `.env.local` に Firebase / Secret を設定
5. Firebase Console で Anonymous Auth と Firestore を有効化

`.env.local` 例（抜粋）:

```bash
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_TIMEOUT_MS=8000
```

---

## 21. 環境変数説明

### 21.1 クライアントSDK（Next.js公開）

- `NEXT_PUBLIC_FIREBASE_API_KEY`: Firebase Web API Key
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`: Authドメイン（`<project>.firebaseapp.com`）
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`: Firebase Project ID
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`: Storageバケット
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`: Sender ID
- `NEXT_PUBLIC_FIREBASE_APP_ID`: Firebase App ID

### 21.2 サーバーSDK（Vercel Functions / Worker）

- `FIREBASE_PROJECT_ID`: Firebase Project ID
- `FIREBASE_CLIENT_EMAIL`: Service Account client email
- `FIREBASE_PRIVATE_KEY`: Service Account private key（改行は `\n` 形式）

### 21.3 内部API保護

- `CRON_SECRET`: Cronエンドポイント呼び出し用Bearer Secret
- `WORKER_SECRET`: Worker API呼び出し用Bearer Secret

### 21.4 OpenAI（サーバー専用）

- `OPENAI_API_KEY`: OpenAI APIキー（必須）
- `OPENAI_MODEL`: 利用モデル名（例: `gpt-4o-mini`）
- `OPENAI_BASE_URL`: OpenAI APIベースURL（通常は `https://api.openai.com/v1`）
- `OPENAI_TIMEOUT_MS`: OpenAIリクエストタイムアウト（ミリ秒）

---

## 22. ローカル開発手順

1. 開発サーバー起動

```bash
npm run dev
```

2. テスト実行

```bash
npm test
```

3. 型チェック

```bash
npm run typecheck
```

4. ブラウザで `http://localhost:3000` を開く

---

## 23. デプロイ手順（Vercel / Firebase）

### 23.1 Firebase側

1. Firebaseプロジェクト作成
2. Authenticationで Anonymous を有効化
3. FirestoreをNativeモードで作成
4. Service Accountキーを発行（Vercel環境変数へ設定）

### 23.2 Vercel側

1. GitリポジトリをVercelへ接続
2. Environment Variablesに `.env.example` の全項目を登録
3. `vercel.json` のCron設定を有効化
4. デプロイ実行（Preview/Production）
5. Productionで `/api/cron/jobs` が定期実行されることを確認

---

## 24. 運用監視指標

- `jobs成功率`
  - 定義: `done / (done + failed)`（期間集計）
- `生成時間`
  - 定義: `jobs.createdAt -> jobs.done(updatedAt)` の経過時間
- `採用数`
  - 定義: 1 materialあたり `expressions` 保存件数（`persistedCount`）

補足: 詳細な運用手順・障害対応フローは [OPERATIONS.md](./docs/OPERATIONS.md) を参照。

---

## 25. 既知の制約と今後の拡張

### 25.1 既知の制約

- YouTubeの公開動画のみ対応（非公開/限定公開は対象外）
- 重いNLP/LLM処理はワーカー依存で、実行時間制約の影響を受ける
- 現在の抽出・スコアリングはルールベース中心（精度改善余地あり）
- 監視は最小構成（詳細ダッシュボードは未実装）

### 25.2 今後の拡張

- OpenAI連携の本実装（re-eval / examples品質向上）
- 復習機能（SRS、クイズ、進捗可視化）
- 運用ダッシュボード（失敗理由、P95生成時間、採用率推移）
- 字幕ソースの品質評価とASRフォールバック高度化

### 19.2 score/reeval後の候補（_pipeline state）

```json
{
  "expressionText": "long term strategy",
  "axisScores": {
    "utility": 78,
    "portability": 70,
    "naturalness": 72,
    "c1_value": 67,
    "context_robustness": 55
  },
  "flagsFinal": [],
  "scoreFinal": 71,
  "decision": "reject",
  "occurrences": [
    {
      "startMs": 1200,
      "endMs": 4200,
      "segmentId": "seg_1"
    }
  ]
}
```

### 19.3 threshold採用後のpersist出力（materials/{materialId}/expressions）

```json
{
  "expressionText": "align on priorities",
  "scoreFinal": 82,
  "axisScores": {
    "utility": 85,
    "portability": 76,
    "naturalness": 74,
    "c1_value": 79,
    "context_robustness": 70
  },
  "meaningJa": "優先事項について認識を合わせる",
  "reasonShort": "5軸評価=82, 出現=2",
  "scenarioExample": "We should align on priorities before the client call.",
  "flagsFinal": [],
  "occurrences": [
    {
      "startMs": 1200,
      "endMs": 4200,
      "segmentId": "seg_1"
    },
    {
      "startMs": 8200,
      "endMs": 10100,
      "segmentId": "seg_5"
    }
  ]
}
```
