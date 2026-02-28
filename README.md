# Listening App

YouTube の公開動画 URL を入力すると、字幕・重要表現・タップ辞書を備えたリスニング教材を生成する Next.js アプリです。

## 概要

- フロント/サーバー: Next.js on Vercel
- 認証: Firebase Authentication (Anonymous)
- DB: Firestore
- 非同期処理: Firestore `jobs` + 即時実行 + Worker API
- 生成 AI: OpenAI API

## 現状の実装範囲

### 実装済み

- YouTube 公開動画 URL の登録
- 同一 `youtubeId + pipelineVersion` の教材再利用
- 教材メタ情報取得
- 字幕セグメント取得
- 重要表現一覧取得
- 字幕タップ時の glossary 生成/キャッシュ
- 匿名ユーザーの表現状態取得/更新
- Firestore `jobs` を使ったジョブ投入、ロック、再試行、stale lock 回収
- Worker API によるパイプライン実行
- Firestore Security Rules の雛形管理

### MVP として未対応

- Firebase Admin による ID token 検証
- glossary API のレート制御
- 公開教材 / 非公開教材の可視性切り替え
- 復習機能、SRS、クイズ、進捗ダッシュボード
- YouTube 以外の動画ソース
- 管理画面や手動キュレーション

## アーキテクチャ

### 主要コレクション

| パス | 用途 | クライアント read | クライアント write |
| --- | --- | --- | --- |
| `materials/{materialId}` | 教材メタ情報 | 可 | 不可 |
| `materials/{materialId}/segments/{segmentId}` | 字幕 | 可 | 不可 |
| `materials/{materialId}/expressions/{expressionId}` | 重要表現 | 可 | 不可 |
| `materials/{materialId}/glossary/{glossaryId}` | タップ辞書キャッシュ | 可 | 不可 |
| `jobs/{jobId}` | 非同期ジョブ | 不可 | 不可 |
| `users/{uid}/expressions/{expressionId}` | 学習状態 | 本人のみ | 本人のみ |

`users/{uid}/expressions` は本人のみ更新可能です。更新可能フィールドは `status` と `updatedAt` のみで、`status` は `saved | ignored | mastered` に限定します。

### ジョブ実行の流れ

1. `POST /api/materials` が教材を作成または再利用
2. `jobs/{jobId}` を `queued` で作成
3. API 内で即時に `runJobToCompletion()` を呼び、可能な範囲まで処理
4. 必要に応じて外部スケジューラから `dispatch` / `recover-stale` を呼ぶ
5. `jobs` は Firestore transaction でロックし、指数バックオフで再試行

## API

| API | 用途 | 認可 |
| --- | --- | --- |
| `POST /api/materials` | 教材登録、重複判定、ジョブ投入 | 認証必須。現実装は `resolveRequestUser()` により `x-user-id` フォールバックあり |
| `GET /api/materials/:materialId` | 教材メタ情報取得 | 匿名可 |
| `GET /api/materials/:materialId/segments` | 字幕取得 | 匿名可 |
| `GET /api/materials/:materialId/expressions` | 重要表現取得 | 匿名可 |
| `POST /api/materials/:materialId/glossary` | glossary 生成/取得 | 匿名可 |
| `GET /api/users/me/expressions` | 自分の表現状態取得 | 本人のみ |
| `PUT /api/users/me/expressions/:expressionId` | 自分の表現状態更新 | 本人のみ |
| `POST /api/jobs/dispatch` | ジョブをロックする補助 API | `CRON_SECRET` または `WORKER_SECRET` |
| `POST /api/worker/jobs/dispatch` | due job をロックして処理 | `CRON_SECRET` または `WORKER_SECRET` |
| `POST /api/worker/jobs/recover-stale` | stale lock 回収 | `CRON_SECRET` または `WORKER_SECRET` |
| `GET /api/cron/jobs` | cron 互換入口。ロック後に worker を呼ぶ | `CRON_SECRET` |
| `POST /api/worker/material-pipeline` | 単一 job 実行 | `WORKER_SECRET` |

## セキュリティと実装上の注意

- Firestore Rules は [firestore.rules](./firestore.rules) で管理します。
- 主要な本番アクセスは Next.js API + `firebase-admin` 経由です。
- そのため Firestore Rules は直接 SDK アクセスの制御には効きますが、API 認可そのものは担保しません。
- 現在の `resolveRequestUser()` は Firebase ID token をまだ検証せず、`x-user-id` ヘッダーフォールバックを含みます。
- 本番運用では Firebase Admin による ID token 検証へ置き換える前提です。

## セットアップ

### 前提

- Node.js 20 以上
- Firebase プロジェクト
- Vercel プロジェクト
- OpenAI API Key

### 環境変数

`.env.example` を `.env.local` にコピーして設定します。

```bash
cp .env.example .env.local
```

#### クライアント SDK

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

#### サーバー SDK

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

#### 内部 API 認証

- `CRON_SECRET`
  - `GET /api/cron/jobs`
  - `POST /api/jobs/dispatch`
  - `POST /api/worker/jobs/dispatch`
  - `POST /api/worker/jobs/recover-stale`
- `WORKER_SECRET`
  - `POST /api/jobs/dispatch`
  - `POST /api/worker/jobs/dispatch`
  - `POST /api/worker/jobs/recover-stale`
  - `POST /api/worker/material-pipeline`
  - `GET /api/cron/jobs` が内部で worker を呼ぶときにも使用

#### OpenAI

- `OPENAI_API_KEY`: 必須
- `OPENAI_MODEL`: 任意。既定値は `gpt-4o-mini`
- `OPENAI_BASE_URL`: 任意。既定値は `https://api.openai.com/v1`
- `OPENAI_TIMEOUT_MS`: 任意。既定値は `8000`

## ローカル起動

```bash
npm install
npm run dev
```

確認項目:

- `http://localhost:3000` を開ける
- 匿名認証が初期化される
- Firestore 初期化エラーが出ない

## デプロイ

### Firebase

1. Authentication で Anonymous を有効化
2. Firestore を Native モードで作成
3. Service Account を発行して Vercel に設定
4. 必要なら Firestore Rules を反映

```bash
firebase deploy --only firestore:rules
```

### Vercel

1. リポジトリを接続
2. `.env.example` の値を Environment Variables に設定
3. Preview / Production をデプロイ

## 外部スケジューラ

MVP では `POST /api/materials` 実行時にその場でジョブ処理を開始します。常時スケジューラは必須ではありません。

使う場合の目的は次の 2 つです。

- 取りこぼした `queued` job の再処理
- stale lock の回収

### 推奨構成

- `POST /api/worker/jobs/dispatch`
  - ヘッダ: `Authorization: Bearer <WORKER_SECRET>` もしくは `Bearer <CRON_SECRET>`
  - Body: `{"limit": 5}`
  - 目安: 5 分ごと
- `POST /api/worker/jobs/recover-stale`
  - ヘッダ: `Authorization: Bearer <WORKER_SECRET>` もしくは `Bearer <CRON_SECRET>`
  - Body なし
  - 目安: 15 分ごと

### `cron-job.org` 例

1. `dispatch` 用ジョブを追加
2. URL を `https://<your-app>.vercel.app/api/worker/jobs/dispatch` に設定
3. Method を `POST` に設定
4. Header に `Authorization: Bearer <WORKER_SECRET>` と `Content-Type: application/json` を設定
5. Body に `{"limit":5}` を設定
6. 別ジョブで `recover-stale` を `https://<your-app>.vercel.app/api/worker/jobs/recover-stale` に向ける

`GET /api/cron/jobs` は cron 互換入口として残っていますが、新規設定では `worker/jobs/*` を直接叩く運用の方が単純です。

## 開発コマンド

```bash
npm run typecheck
npm test
npm run build
```

## 運用ドキュメント

詳細な監視、障害対応、Rules 反映手順は [docs/OPERATIONS.md](./docs/OPERATIONS.md) を参照してください。
