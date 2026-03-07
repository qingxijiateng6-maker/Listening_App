# Listening App

YouTube の公開動画を教材化し、字幕を見ながら学習した表現を自分で保存していくリスニング学習アプリです。

現在は、字幕取得本体を Vercel ではなく Cloud Run の caption worker に分離しています。Next.js 側は教材登録、認証、Firestore CRUD、Cloud Run worker の wake ping だけを担当します。

## 現在の仕様

- YouTube 公開動画 URL を登録すると教材を作成する
- 動画メタ情報と字幕は Cloud Run worker が取得し、Firestore に保存する
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
- Web サーバー処理: Next.js Route Handlers + `firebase-admin`
- 非同期処理: Firestore `jobs` + Cloud Run caption worker
- スケジューラ: Cloud Scheduler
- シークレット管理: Google Secret Manager
- テスト: Vitest + Testing Library

## 教材生成フロー

1. `POST /api/materials` で YouTube URL を登録する
2. 動画 URL を検証し、同一ユーザー内の重複教材を再利用する
3. Web 側が `jobs/{jobId}` に `material_pipeline` ジョブを投入する
4. Web 側が Cloud Run caption worker に wake ping を送る
5. Cloud Run worker が `meta -> captions -> format` を実行する
6. ローディング画面の `POST /api/materials/[materialId]/prepare` は worker を再度 wake しつつ最新状態を返す
7. 完了後、`materials` と `segments` に教材データを保存する

字幕生成後の表現保存はパイプラインではなく、学習画面のフォームから明示的に行います。

## API

### ユーザー向け API

| メソッド | パス | 用途 |
| --- | --- | --- |
| `GET` | `/api/materials` | 自分の教材一覧を取得 |
| `POST` | `/api/materials` | YouTube URL から教材を登録 |
| `GET` | `/api/materials/[materialId]` | 教材詳細を取得 |
| `POST` | `/api/materials/[materialId]/prepare` | Cloud Run worker を wake し、最新状態を返す |
| `DELETE` | `/api/materials/[materialId]` | 教材を削除 |
| `GET` | `/api/materials/[materialId]/segments` | 字幕一覧を取得 |
| `GET` | `/api/materials/[materialId]/expressions` | 保存済み表現一覧を取得 |
| `POST` | `/api/materials/[materialId]/expressions` | 表現を保存 |
| `DELETE` | `/api/materials/[materialId]/expressions/[expressionId]` | 表現を削除 |

### Cloud Run worker 側 endpoint

この Next.js アプリ内には route を持たせず、Cloud Run service 側で次を提供します。

- `GET /healthz`
- `POST /internal/jobs/dispatch`

`POST /internal/jobs/dispatch` は worker 用の dispatch secret を前提にします。Web 側では同じ値を `CAPTION_WORKER_TOKEN` として保持し、wake ping に使います。

## データ構造

主要コレクションは次の通りです。

| パス | 用途 |
| --- | --- |
| `materials/{materialId}` | 教材メタ情報 |
| `materials/{materialId}/segments/{segmentId}` | 字幕セグメント |
| `materials/{materialId}/expressions/{expressionId}` | ユーザーが保存した表現 |
| `materials/{materialId}/_pipeline/state:{version}` | 教材生成の内部状態 |
| `jobs/{jobId}` | 教材生成ジョブ |

## セットアップ

### 前提

- Node.js 20 以上
- Firebase プロジェクト
- Vercel プロジェクト
- Cloud Run にデプロイ済みの caption worker
- Cloud Scheduler
- Secret Manager

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

#### Cloud Run worker wake ping

- `CAPTION_WORKER_BASE_URL`
- `CAPTION_WORKER_TOKEN`

`CAPTION_WORKER_TOKEN` は Cloud Run worker 側の dispatch secret と同じ値を使います。

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
- `POST /api/materials` 後に Cloud Run worker への wake ping が失敗しても、教材登録 API 自体は 200 を返す

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
4. Service Account を発行し、Vercel と Cloud Run に必要な権限を付与する
5. 必要に応じて Firestore Rules を反映する

```bash
firebase deploy --only firestore:rules
```

### Cloud Run

1. caption worker を Cloud Run にデプロイする
2. Secret Manager に worker 用 dispatch secret を登録する
3. 必要なら YouTube cookies を Secret Manager または volume mount で worker に渡す
4. worker 側に Firestore へアクセスできる service account を付与する
5. `POST /internal/jobs/dispatch` が dispatch secret 付きで 2xx を返すことを確認する

### Cloud Scheduler

1. Cloud Run worker の `POST /internal/jobs/dispatch` を呼ぶ job を作成する
2. 実行頻度は 5 分ごとを基本にする
3. `Authorization: Bearer <dispatch-secret>` を header に設定する
4. Scheduler 実行履歴で 2xx を確認する

### Secret Manager

最低限、次の secret を管理対象にします。

- caption worker dispatch secret
- worker が cookies を必要とする場合の cookies secret

Vercel 側の `CAPTION_WORKER_TOKEN` には caption worker dispatch secret と同じ値を設定します。

### Vercel

1. リポジトリを接続する
2. `.env.example` の値を Environment Variables に設定する
3. `CAPTION_WORKER_BASE_URL` に Cloud Run service URL を設定する
4. `CAPTION_WORKER_TOKEN` に Secret Manager の caption worker dispatch secret と同じ値を設定する
5. Preview / Production をデプロイする

## テスト

現在のテストは主に以下をカバーしています。

- 動画登録から学習画面遷移までの統合動作
- 学習画面での表現保存、字幕マッチ表示、削除
- 保存表現一覧、履歴一覧、認証 UI
- API route の認可とレスポンス
- Cloud Run wake ping client
- ジョブ投入と字幕 parser / formatting utility

## 補足ドキュメント

- 運用手順: [docs/OPERATIONS.md](./docs/OPERATIONS.md)
