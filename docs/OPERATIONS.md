# OPERATIONS

## 1. 目的

本ドキュメントは、Listening App の本番運用で必要な監視・障害対応・定期運用手順をまとめたものです。

## 2. 対象システム

- Web/App: Next.js (Vercel)
- 認証: Firebase Anonymous Auth
- DB: Firestore
- 非同期処理: Firestore `jobs` + 登録API即時実行 + 外部スケジューラ + Worker API

## 2.1 Firestore アクセス方針

| パス | 直接 read | 直接 write | 運用メモ |
| --- | --- | --- | --- |
| `materials` | 許可 | 禁止 | 公開教材メタ。更新は server/admin のみ |
| `materials/{materialId}/segments` | 許可 | 禁止 | 公開字幕 |
| `materials/{materialId}/expressions` | 許可 | 禁止 | 公開重要表現 |
| `materials/{materialId}/glossary` | 許可 | 禁止 | 公開キャッシュ。生成は API 経由 |
| `jobs` | 禁止 | 禁止 | worker/admin 専用 |
| `users/{uid}/expressions` | 本人のみ | 本人のみ | `status` と `updatedAt` のみ更新可能 |

- Firestore Rules は `firestore.rules` で管理する
- 主要な本番アクセスは Next.js API + `firebase-admin` 経由なので、Rules 変更だけでは API 認可は変わらない
- `users/{uid}/expressions` の API 認可は現状 `resolveRequestUser()` に依存し、Firebase ID token 検証は未実装

## 3. 監視指標（KPI / SLO候補）

### 3.1 jobs成功率

- 定義: `done / (done + failed)`（期間: 1h, 24h）
- 閾値例:
  - Warning: 95%未満
  - Critical: 90%未満

### 3.2 生成時間

- 定義: `jobs.createdAt` から `jobs.updatedAt(status=done)` まで
- 監視:
  - P50
  - P95
  - 最大値
- 閾値例:
  - Warning: P95 > 10分
  - Critical: P95 > 20分

### 3.3 採用数（重要表現）

- 定義: `materials/{materialId}/_pipeline/state:{pipelineVersion}.persistedCount`
- 監視:
  - material単位の採用数分布
  - 直近24h平均採用数
- 閾値例:
  - Warning: 平均採用数が急減（前週比 -30%以上）

## 4. 日次運用

1. `jobs` の `failed` 件数確認
2. `processing` 長期滞留（stale lock）確認
3. 直近デプロイ以降の `jobs成功率` と `生成時間` 比較
4. 採用数が異常に少ない/多い `material` をサンプリング確認

## 4.1 外部スケジューラ運用

- Hobbyプランでは Vercel Cron を使わず、外部スケジューラから Worker API を叩く
- 推奨は `cron-job.org`
- 代替は GitHub Actions または Cloudflare Workers Cron

最低限の実行対象:

1. `POST /api/worker/jobs/dispatch`
2. `POST /api/worker/jobs/recover-stale`

推奨間隔:

- `dispatch`: 5分ごと
- `recover-stale`: 15分ごと

共通ヘッダ:

- `Authorization: Bearer <WORKER_SECRET>`
- `Content-Type: application/json`

## 5. 障害対応フロー

### 5.1 症状: failed急増

- 確認:
  - `jobs.errorCode`
  - `jobs.errorMessage`
  - Vercel Function Logs
- 初動:
  - 一時的な外部障害なら `nextRunAt` を調整して再実行
  - 恒久エラーなら該当stepのロジック修正・再デプロイ

### 5.2 症状: processing滞留

- 確認:
  - `lockedAt` がTTL超過しているか
- 初動:
  - stale lock回収処理の起動状態を確認
  - 必要なら該当ジョブを `queued` に戻して再実行

### 5.3 症状: 採用数の異常低下

- 確認:
  - `scoreFinal` 分布
  - `unsafe_or_inappropriate` 付与率
  - `threshold` 設定の変更有無
- 初動:
  - recent deploy の差分確認
  - ルール/ペナルティの過剰適用有無をチェック

## 6. デプロイ運用（Vercel / Firebase）

1. `main` マージ前に `npm test` / `npm run typecheck`
2. Vercel Previewデプロイで以下確認
   - 動画登録
   - job作成とdispatch
   - 学習画面表示
3. Productionデプロイ
4. デプロイ後30分の重点監視
   - jobs成功率
   - failed件数
   - P95生成時間
5. 外部スケジューラの疎通確認
   - `dispatch` が 2xx を返す
   - `recover-stale` が 2xx を返す
   - Authorization header の設定ミスがない

## 6.1 Firestore Rules 反映手順

1. `firestore.rules` と `firebase.json` の差分を確認
2. Firebase CLI で対象プロジェクトを選択
3. `firebase deploy --only firestore:rules` を実行
4. 反映後、Firestore Rules Playground または Emulator で以下を確認
   - 未認証で `materials` 読み取り可
   - 未認証で `jobs` 読み取り不可
   - 未認証で `users/{uid}/expressions` 読み書き不可
   - 本人 UID のみ `users/{uid}/expressions` 更新可
5. 本番 API の疎通も別途確認
   - `POST /api/materials` が 401/200 を期待通り返す
   - `GET /api/users/me/expressions` が本人のみ取得できる

## 6.2 Firestore Rules 変更時のレビュー観点

- `materials` / `segments` / `expressions` / `glossary` にクライアント write が混入していないか
- `jobs` が誤って公開されていないか
- `users/{uid}/expressions` に本人以外の read/write 経路がないか
- API 実装の認可と README 記載がずれていないか

## 7. 既知の制約

- YouTube公開動画以外は非対応
- Worker実行時間制約により、長尺動画で再試行回数が増える場合がある
- 現在は最小監視構成で、専用ダッシュボードは未実装
- GitHub Actions の schedule は最短5分で、時刻遅延が起きることがある
- Firestore Rules は直接 SDK アクセスにのみ適用され、`firebase-admin` 経由の API 書き込みは対象外
- サーバー認可は暫定的に `x-user-id` ヘッダーフォールバックを含み、Firebase ID token の厳密検証は未実装

## 8. 今後の拡張

- BigQuery連携による監視メトリクス可視化
- アラート自動通知（Slack / Email）
- failedジョブ自動分類（ネットワーク/レート制限/仕様エラー）
- モデル品質監視（採用率、reject理由、ユーザー保存率）
