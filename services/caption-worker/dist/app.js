import Fastify from "fastify";
import { isAuthorizedRequest } from "./auth.js";
import { createYtDlpCaptionProvider } from "./captions/ytDlp.js";
import { loadConfig } from "./config.js";
import { getAdminDb } from "./firestore.js";
import { createWorkerId, JobQueueService } from "./jobs/queue.js";
import { createLogger } from "./logging.js";
import { MaterialPipelineService } from "./pipeline/materialPipeline.js";
export function createApp(input) {
    const config = input?.config ?? loadConfig();
    const logger = input?.logger ?? createLogger();
    const dispatchHandler = input?.dispatchHandler ??
        (() => {
            const db = getAdminDb();
            const captionProvider = createYtDlpCaptionProvider(config, logger);
            const pipeline = new MaterialPipelineService(db, captionProvider, config, logger);
            return new JobQueueService(db, pipeline, config, logger);
        })();
    const app = Fastify({
        logger: false,
    });
    app.get("/healthz", async () => {
        return { ok: true };
    });
    app.post("/internal/jobs/dispatch", async (request, reply) => {
        if (!isAuthorizedRequest(request, config.workerSecret)) {
            return reply.code(401).send({ error: "Unauthorized" });
        }
        const body = (request.body ?? {});
        const requestedLimit = typeof body.limit === "number" ? body.limit : undefined;
        const limitCount = requestedLimit && requestedLimit > 0 && requestedLimit <= 20
            ? requestedLimit
            : config.dispatchBatchSize;
        const result = await dispatchHandler.dispatchAndProcessDueJobs(limitCount, createWorkerId("caption-worker"));
        return reply.code(200).send(result);
    });
    app.setErrorHandler((error, request, reply) => {
        logger.error("http.request_failed", {
            method: request.method,
            path: request.url,
            subtitleLanguage: "",
            subtitleKind: "",
            ytDlpExitCode: null,
            error,
        });
        reply.code(500).send({ error: "Internal Server Error" });
    });
    return app;
}
