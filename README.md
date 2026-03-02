# Listening App

YouTube の公開動画を教材化し、字幕を見ながら学習した表現を自分で保存していくリスニング学習アプリです。

以前の「表現を自動抽出して、意味や例文も自動生成する」仕様ではなく、現在は学習者が必要な表現を手動で保存する構成になっています。

## 現在の仕様

- YouTube 公開動画 URL を登録すると教材を作成する
- 動画メタ情報と字幕を取得し、教材として保存する
- 学習画面で表現・意味・例文を自分で入力して保存する
- 保存した表現ごとに、その表現を含む字幕シーンを学習画面で参照できる
- 保存した表現を動画単位で一覧表示できる
- 登録済み動画の履歴表示と削除ができる
- Firebase Authentication で匿名利用を開始し、必要に応じて Google ログインへ切り替えられる

## 画面構成

| パス | 内容 |
| --- | --- |
| `/` | YouTube URL 登録、履歴画面への導線 |
| `/materials/loading` | 教材登録中のローディング画面 |
| `/materials` | 登録済み動画の履歴一覧 |
| `/materials/[materialId]` | 動画再生、字幕確認、表現の手動保存 |
| `/expressions` | 保存した表現の一覧 |

## 技術スタック

- フロントエンド: Next.js 15 / React 19 / App Router
- 認証: Firebase Authentication
- データベース: Firestore
- サーバー処理: Next.js Route Handlers + `firebase-admin`
- 非同期処理: Firestore `jobs` コレクション + Worker API
- テスト: Vitest + Testing Library

## データ構造

主要コレクションは次の通りです。

| パス | 用途 |
| --- | --- |
| `materials/{materialId}` | 教材メタ情報 |
| `materials/{materialId}/segments/{segmentId}` | 字幕セグメント |
| `materials/{materialId}/expressions/{expressionId}` | ユーザーが保存した表現 |
| `materials/{materialId}/_pipeline/state:{version}` | 教材生成の内部状態 |
| `jobs/{jobId}` | 教材生成ジョブ |

`expressions` には少なくとも次の情報を保存します。

- `expression`
- `meaning`
- `exampleSentence`
- `createdAt`
- `updatedAt`

## 教材生成フロー

1. `POST /api/materials` で YouTube URL を登録する
2. 動画 URL を検証し、同一ユーザー内の重複教材を再利用する
3. `jobs/{jobId}` に `material_pipeline` ジョブを投入する
4. `meta` -> `captions` -> `format` の順に処理する
5. 完了後、`materials` と `segments` に教材データを保存する

字幕生成後の表現保存はパイプラインではなく、学習画面のフォームから明示的に行います。

## API

### ユーザー向け API

| メソッド | パス | 用途 |
| --- | --- | --- |
| `GET` | `/api/materials` | 自分の教材一覧を取得 |
| `POST` | `/api/materials` | YouTube URL から教材を登録 |
| `GET` | `/api/materials/[materialId]` | 教材詳細を取得 |
| `DELETE` | `/api/materials/[materialId]` | 教材を削除 |
| `GET` | `/api/materials/[materialId]/segments` | 字幕一覧を取得 |
| `GET` | `/api/materials/[materialId]/expressions` | 保存済み表現一覧を取得 |
| `POST` | `/api/materials/[materialId]/expressions` | 表現を保存 |
| `DELETE` | `/api/materials/[materialId]/expressions/[expressionId]` | 表現を削除 |

### Worker / 運用 API

| メソッド | パス | 用途 |
| --- | --- | --- |
| `POST` | `/api/jobs/dispatch` | ジョブロック補助 API |
| `POST` | `/api/worker/jobs/dispatch` | due job をロックして実行 |
| `POST` | `/api/worker/jobs/recover-stale` | stale lock 回収 |
| `POST` | `/api/worker/material-pipeline` | 単一ジョブ実行 |
| `GET` | `/api/cron/jobs` | cron 互換の入口 |

## 認証

- クライアントは Firebase Authentication で匿名ユーザーを自動作成します
- 必要に応じて Google ログインへ切り替えられます
- API は Firebase ID token を `Authorization: Bearer <token>` として受け取り、サーバー側で検証します
- Firestore への主な読み書きはクライアント SDK 直叩きではなく、Next.js API 経由です

## ディレクトリ構成

```text
.
|-- docs/
|   `-- OPERATIONS.md
|-- src/
|   |-- app/
|   |   |-- api/
|   |   |   |-- cron/
|   |   |   |-- jobs/
|   |   |   |-- materials/
|   |   |   `-- worker/
|   |   |-- expressions/
|   |   |-- materials/
|   |   |-- globals.css
|   |   |-- layout.tsx
|   |   `-- page.tsx
|   |-- components/
|   |   |-- auth/
|   |   |-- firebase/
|   |   `-- materials/
|   |-- lib/
|   |   |-- firebase/
|   |   |-- jobs/
|   |   |-- server/
|   |   `-- youtube.ts
|   |-- pages/
|   |   `-- _app.tsx
|   |-- test/
|   `-- types/
|-- firestore.rules
|-- firebase.json
|-- next.config.ts
|-- package.json
|-- vercel.json
`-- vitest.config.ts
```

補足:

- `src/components/materials/`
  学習画面、動画登録、履歴、保存表現一覧など UI の中心
- `src/lib/jobs/`
  教材生成パイプラインとジョブ制御
- `src/lib/server/materials.ts`
  教材・字幕・保存表現のサーバー側 CRUD
- `src/lib/server/llm/`
  現在の主要導線では未使用だが、将来拡張用の LLM 基盤コード

## セットアップ

### 前提

- Node.js 20 以上
- Firebase プロジェクト
- Vercel プロジェクト

### インストール

```bash
npm install
```

### 環境変数

`.env.example` を `.env.local` にコピーして設定します。

```bash
cp .env.example .env.local
```

#### Firebase Client SDK

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

#### Firebase Admin SDK

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

#### Internal API Auth

- `CRON_SECRET`
- `WORKER_SECRET`

#### Optional

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`
- `OPENAI_TIMEOUT_MS`

現行の主要機能では OpenAI は必須ではありません。

## ローカル起動

```bash
npm run dev
```

起動後は `http://localhost:3000` を開き、次を確認します。

- 匿名ログインが開始される
- YouTube URL の登録画面が表示される
- Firebase 初期化エラーが出ない

## 開発コマンド

```bash
npm run dev
npm run typecheck
npm test
npm run build
```

## デプロイ

### Firebase

1. Authentication で Anonymous を有効化する
2. 必要なら Google ログインも有効化する
3. Firestore を Native モードで作成する
4. Service Account を発行し、Vercel に環境変数を設定する
5. 必要に応じて Firestore Rules を反映する

```bash
firebase deploy --only firestore:rules
```

### Vercel

1. リポジトリを接続する
2. `.env.example` の値を Environment Variables に設定する
3. Preview / Production をデプロイする

## 外部スケジューラ

`POST /api/materials` 内でジョブ実行を開始するため、常時スケジューラは必須ではありません。

ただし次の用途で外部スケジューラを使えます。

- 取りこぼした `queued` job の再処理
- stale lock の回収

推奨エンドポイント:

- `POST /api/worker/jobs/dispatch`
- `POST /api/worker/jobs/recover-stale`

## テスト

現在のテストは主に以下をカバーしています。

- 動画登録から学習画面遷移までの統合動作
- 学習画面での表現保存、字幕マッチ表示、削除
- 保存表現一覧、履歴一覧、認証 UI
- API route の認可とレスポンス
- ジョブキューと字幕整形ロジック

## 補足ドキュメント

- 運用手順: [docs/OPERATIONS.md](./docs/OPERATIONS.md)

