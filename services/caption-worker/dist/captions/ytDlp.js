import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSubtitleFormatPreference, extractVideoLanguage, selectBestSubtitleTrack } from "./ranking.js";
import { parseCaptionPayload } from "./parsers.js";
class YtDlpCommandError extends Error {
    exitCode;
    stderr;
    stdout;
    constructor(message, exitCode, stderr, stdout) {
        super(message);
        this.exitCode = exitCode;
        this.stderr = stderr;
        this.stdout = stdout;
        this.name = "YtDlpCommandError";
    }
}
function cleanMessage(value) {
    const trimmed = value.trim();
    return trimmed || "yt-dlp command failed.";
}
async function fileExists(filePath) {
    if (!filePath) {
        return false;
    }
    try {
        await access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
function createDefaultRunner(binary) {
    return async (args, options) => {
        return new Promise((resolve, reject) => {
            const child = spawn(binary, [...args], {
                cwd: options?.cwd,
                stdio: ["ignore", "pipe", "pipe"],
            });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => {
                stdout += chunk.toString();
            });
            child.stderr.on("data", (chunk) => {
                stderr += chunk.toString();
            });
            child.on("error", reject);
            child.on("close", (exitCode) => {
                resolve({ stdout, stderr, exitCode });
            });
        });
    };
}
function inferSubtitleExtension(fileName) {
    const parts = path.basename(fileName).split(".");
    return parts.length >= 2 ? parts[parts.length - 1]?.toLowerCase() : undefined;
}
function buildBaseArgs(cookiesPath) {
    const args = ["--no-warnings", "--no-progress"];
    if (cookiesPath) {
        args.push("--cookies", cookiesPath);
    }
    return args;
}
async function runOrThrow(runner, args, logger, logMessage, fields, options) {
    const result = await runner(args, options);
    logger.info(logMessage, {
        ...fields,
        ytDlpExitCode: result.exitCode,
    });
    if (result.exitCode !== 0) {
        throw new YtDlpCommandError(cleanMessage(result.stderr || result.stdout), result.exitCode, result.stderr, result.stdout);
    }
    return result;
}
function buildVideoInfoMetadata(info) {
    return {
        title: info.title?.trim() || undefined,
        channel: info.channel?.trim() || info.uploader?.trim() || undefined,
        durationSec: typeof info.duration === "number" && Number.isFinite(info.duration)
            ? Math.max(0, Math.round(info.duration))
            : undefined,
        videoLanguage: extractVideoLanguage(info),
    };
}
export function createYtDlpCaptionProvider(config, logger, runner = createDefaultRunner(config.ytDlpBinary)) {
    return {
        async fetchCaptions(input) {
            const cookiesPath = (await fileExists(config.ytDlpCookiesPath)) ? config.ytDlpCookiesPath : undefined;
            if (!cookiesPath) {
                logger.warn("caption.cookies_path_missing", {
                    materialId: input.materialId,
                    jobId: input.jobId,
                    attempt: input.attempt,
                    subtitleLanguage: "",
                    subtitleKind: "",
                    ytDlpExitCode: null,
                    configuredCookiesPath: config.ytDlpCookiesPath ?? "",
                });
            }
            try {
                const infoArgs = [
                    ...buildBaseArgs(cookiesPath),
                    "--dump-single-json",
                    "--skip-download",
                    input.youtubeUrl,
                ];
                const infoResult = await runOrThrow(runner, infoArgs, logger, "caption.video_info_loaded", {
                    materialId: input.materialId,
                    jobId: input.jobId,
                    attempt: input.attempt,
                    subtitleLanguage: "",
                    subtitleKind: "",
                });
                const info = JSON.parse(infoResult.stdout);
                const selectedTrack = selectBestSubtitleTrack({
                    info,
                    preferredLangs: config.captionPreferredLangs,
                });
                if (!selectedTrack) {
                    logger.warn("caption.track_not_found", {
                        materialId: input.materialId,
                        jobId: input.jobId,
                        attempt: input.attempt,
                        subtitleLanguage: "",
                        subtitleKind: "",
                        ytDlpExitCode: 0,
                    });
                    return {
                        status: "unavailable",
                        source: "yt_dlp",
                        reason: "captions_not_found",
                        message: "No matching subtitle track was available for this video.",
                    };
                }
                const subtitleLanguage = selectedTrack.languageCode;
                const subtitleKind = selectedTrack.kind;
                logger.info("caption.track_selected", {
                    materialId: input.materialId,
                    jobId: input.jobId,
                    attempt: input.attempt,
                    subtitleLanguage,
                    subtitleKind,
                    ytDlpExitCode: 0,
                    videoLanguage: extractVideoLanguage(info) ?? "",
                });
                const tempDir = await mkdtemp(path.join(os.tmpdir(), "caption-worker-"));
                try {
                    const downloadArgs = [
                        ...buildBaseArgs(cookiesPath),
                        "--skip-download",
                        "--force-overwrites",
                        subtitleKind === "auto" ? "--write-auto-subs" : "--write-subs",
                        "--sub-langs",
                        subtitleLanguage,
                        "--sub-format",
                        buildSubtitleFormatPreference(selectedTrack),
                        "-o",
                        "%(id)s.%(ext)s",
                        "-P",
                        `subtitle:${tempDir}`,
                        input.youtubeUrl,
                    ];
                    await runOrThrow(runner, downloadArgs, logger, "caption.track_downloaded", {
                        materialId: input.materialId,
                        jobId: input.jobId,
                        attempt: input.attempt,
                        subtitleLanguage,
                        subtitleKind,
                    });
                    const files = await readdir(tempDir);
                    const subtitleFile = files.find((fileName) => Boolean(inferSubtitleExtension(fileName)));
                    if (!subtitleFile) {
                        return {
                            status: "unavailable",
                            source: "yt_dlp",
                            reason: "captions_not_found",
                            message: "yt-dlp completed without producing a subtitle file.",
                        };
                    }
                    const subtitlePath = path.join(tempDir, subtitleFile);
                    const extension = inferSubtitleExtension(subtitleFile);
                    const rawSubtitle = await readFile(subtitlePath, "utf8");
                    const cues = parseCaptionPayload(rawSubtitle, extension);
                    if (cues.length === 0) {
                        return {
                            status: "unavailable",
                            source: "yt_dlp",
                            reason: "captions_not_found",
                            message: "Selected subtitle track did not contain usable cues.",
                        };
                    }
                    const metadata = buildVideoInfoMetadata(info);
                    return {
                        status: "fetched",
                        source: "yt_dlp",
                        cues,
                        metadata: {
                            ...metadata,
                            subtitleLanguage,
                            subtitleKind,
                            subtitleName: selectedTrack.name,
                        },
                        materialPatch: {
                            title: metadata.title,
                            channel: metadata.channel,
                            durationSec: metadata.durationSec,
                            subtitle: {
                                language: subtitleLanguage,
                                kind: subtitleKind,
                                name: selectedTrack.name,
                                source: "yt_dlp",
                                videoLanguage: metadata.videoLanguage,
                            },
                        },
                    };
                }
                finally {
                    await rm(tempDir, { recursive: true, force: true });
                }
            }
            catch (error) {
                const exitCode = error instanceof YtDlpCommandError ? error.exitCode : null;
                logger.error("caption.fetch_failed", {
                    materialId: input.materialId,
                    jobId: input.jobId,
                    attempt: input.attempt,
                    subtitleLanguage: "",
                    subtitleKind: "",
                    ytDlpExitCode: exitCode,
                    error,
                });
                return {
                    status: "unavailable",
                    source: "yt_dlp",
                    reason: cookiesPath ? "captions_provider_failed" : "captions_provider_not_configured",
                    message: error instanceof Error ? error.message : "yt-dlp failed to fetch subtitles for this video.",
                };
            }
        },
    };
}
