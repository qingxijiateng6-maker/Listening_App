# OPERATIONS

## 1. 目的

本ドキュメントは、Listening App の本番運用で必要な監視、障害対応、定期運用手順をまとめたものです。

## 2. 対象システム

- Web/App: Next.js (Vercel)
- Worker: Cloud Run caption worker
- 認証: Firebase Anonymous Auth
- DB: Firestore
- スケジューラ: Cloud Scheduler
- シークレット管理: Secret Manager
- 非同期処理: Firestore `jobs` + Cloud Run worker

## 2.1 Firestore アクセス方針

| パス | 直接 read | 直接 write | 運用メモ |
| --- | --- | --- | --- |
| `materials` | 許可 | 禁止 | 公開教材メタ。更新は server/admin のみ |
| `materials/{materialId}/segments` | 許可 | 禁止 | 公開字幕 |
| `materials/{materialId}/expressions` | 許可 | 禁止 | 公開重要表現 |
| `jobs` | 禁止 | 禁止 | worker/admin 専用 |
| `users/{uid}/expressions` | 本人のみ | 本人のみ | `status` と `updatedAt` のみ更新可能 |

- Firestore Rules は `firestore.rules` で管理する
- Web 側の主要アクセスは Next.js API + `firebase-admin` 経由
- worker 側の `jobs` / `materials` 更新も service account 経由

## 3. 監視指標

### 3.1 jobs 成功率

- 定義: `done / (done + failed)`（期間: 1h, 24h）
- 閾値例
  - Warning: 95% 未満
  - Critical: 90% 未満

### 3.2 生成時間

- 定義: `jobs.createdAt` から `jobs.updatedAt(status=done)` まで
- 監視
  - P50
  - P95
  - 最大値
- 閾値例
  - Warning: P95 > 10 分
  - Critical: P95 > 20 分

### 3.3 Cloud Scheduler 実行成否

- 定義: caption worker dispatch job の成功率
- 確認対象
  - 直近 24h の失敗回数
  - 連続失敗の有無

### 3.4 Cloud Run 健全性

- 確認対象
  - `/healthz`
  - request error rate
  - cold start / timeout / memory OOM の有無

## 4. 日次運用

1. `jobs` の `failed` 件数確認
2. `processing` 長期滞留の確認
3. 直近デプロイ以降の `jobs成功率` と `生成時間` 比較
4. Cloud Scheduler 実行履歴の失敗有無を確認
5. Cloud Run logs に `POST /internal/jobs/dispatch` の 5xx が増えていないか確認

## 5. 定期実行

### 5.1 Cloud Scheduler

- 実行先: `POST https://<cloud-run-service>/internal/jobs/dispatch`
- 推奨間隔: 5 分ごと
- 必須ヘッダ
  - `Authorization: Bearer <dispatch-secret>`
  - `Content-Type: application/json`
- リクエスト body

```json
{
  "limit": 5
}
```

### 5.2 Secret Manager

最低限、次を管理対象にすること。

- caption worker dispatch secret
- YouTube cookies が必要な場合の cookies secret

Vercel 側の `CAPTION_WORKER_TOKEN` は caption worker dispatch secret と同じ値に揃えること。

## 6. 障害対応フロー

### 6.1 症状: failed 急増

- 確認
  - `jobs.errorCode`
  - `jobs.errorMessage`
  - Cloud Run logs
- 初動
  - 一時的な外部障害なら Cloud Scheduler の再実行と logs 確認
  - 恒久エラーなら worker 側ロジック修正後に再デプロイ

### 6.2 症状: processing 滞留

- 確認
  - `lockedAt` が長時間更新されていないか
  - Cloud Scheduler が止まっていないか
  - Cloud Run revision に異常がないか
- 初動
  - Scheduler job の直近実行結果を確認
  - 必要なら該当 job を `queued` に戻して再実行

### 6.3 症状: Web では登録できるが進捗が進まない

- 確認
  - Vercel の `CAPTION_WORKER_BASE_URL` / `CAPTION_WORKER_TOKEN`
  - Cloud Run の dispatch secret 設定
  - Web 側 logs の `Caption worker wake ping failed.`
- 初動
  - env / secret の不一致を修正
  - Cloud Scheduler が正常に叩けているかも合わせて確認

## 7. デプロイ運用

### 7.1 Worker 変更時

1. worker を build / test
2. Cloud Run に deploy
3. Secret Manager の差分があれば反映
4. Cloud Scheduler から `POST /internal/jobs/dispatch` が 2xx を返すことを確認
5. `GET /healthz` を確認

### 7.2 Web 変更時

1. `npm test`
2. `npm run typecheck`
3. `npm run build`
4. Vercel Preview で以下確認
   - 動画登録
   - `prepare` polling
   - 学習画面表示
5. Production デプロイ
6. デプロイ後 30 分の重点監視
   - Web 側 API error
   - `Caption worker wake ping failed.` の有無
   - jobs 成功率

### 7.3 Firestore Rules 反映手順

1. `firestore.rules` と `firebase.json` の差分を確認
2. Firebase CLI で対象プロジェクトを選択
3. `firebase deploy --only firestore:rules` を実行
4. 反映後、Firestore Rules Playground または Emulator で以下を確認
   - 未認証で `materials` 読み取り可
   - 未認証で `jobs` 読み取り不可
   - 未認証で `users/{uid}/expressions` 読み書き不可
   - 本人 UID のみ `users/{uid}/expressions` 更新可

## 8. 既知の制約

- YouTube 公開動画以外は非対応
- 字幕取得成功率は Cloud Run worker 側の cookies / yt-dlp / YouTube 仕様変更に影響される
- Firestore Rules は直接 SDK アクセスにのみ適用され、`firebase-admin` 経由の書き込みは対象外
- サーバー認可は暫定的に `x-user-id` ヘッダーフォールバックを含み、Firebase ID token の厳密検証は未実装
