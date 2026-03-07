function readEnvString(env, name) {
    const value = env[name]?.trim();
    return value ? value : undefined;
}
function readEnvInt(env, name, fallback) {
    const value = readEnvString(env, name);
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}
export function parsePreferredLangs(value) {
    if (!value) {
        return [];
    }
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}
export function loadConfig(env = process.env) {
    return {
        port: readEnvInt(env, "PORT", 8080),
        workerSecret: readEnvString(env, "WORKER_SECRET") ?? "",
        dispatchBatchSize: readEnvInt(env, "JOB_DISPATCH_BATCH_SIZE", 5),
        jobLockTimeoutMs: readEnvInt(env, "JOB_LOCK_TIMEOUT_MS", 75_000),
        jobMaxAttempts: readEnvInt(env, "JOB_MAX_ATTEMPTS", 6),
        jobBackoffBaseSeconds: readEnvInt(env, "JOB_BACKOFF_BASE_SECONDS", 30),
        materialPipelineBatchWriteLimit: readEnvInt(env, "MATERIAL_PIPELINE_BATCH_WRITE_LIMIT", 400),
        ytDlpBinary: readEnvString(env, "YT_DLP_BINARY") ?? "yt-dlp",
        ytDlpCookiesPath: readEnvString(env, "YT_DLP_COOKIES_PATH") ?? "/secrets/youtube-cookies/cookies.txt",
        captionPreferredLangs: parsePreferredLangs(readEnvString(env, "CAPTION_PREFERRED_LANGS")),
    };
}
