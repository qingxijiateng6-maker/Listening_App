# Caption Worker

Cloud Run 用の字幕 worker です。Firestore の `jobs` コレクションから due job を拾い、`meta -> captions -> format` を完走します。字幕取得は `yt-dlp` と cookies mount を前提にし、`--dump-single-json` で候補 track を見て最適な 1 track のみをダウンロードします。

## Endpoints

- `GET /healthz`
- `POST /internal/jobs/dispatch`

`POST /internal/jobs/dispatch` は `Authorization: Bearer <WORKER_SECRET>` が必要です。

## Local

```bash
cd services/caption-worker
npm install
npm test
npm run build
npm run dev
```

## Docker

```bash
docker build -t caption-worker .
docker run --rm -p 8080:8080 --env-file .env.example caption-worker
```
