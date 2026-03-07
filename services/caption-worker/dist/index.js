import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logging.js";
const config = loadConfig();
const logger = createLogger();
const app = createApp({ config, logger });
async function start() {
    try {
        await app.listen({
            host: "0.0.0.0",
            port: config.port,
        });
        logger.info("caption-worker.started", { port: config.port });
    }
    catch (error) {
        logger.error("caption-worker.start_failed", { error });
        process.exitCode = 1;
    }
}
void start();
async function stop(signal) {
    logger.info("caption-worker.stopping", { signal });
    await app.close();
}
process.on("SIGINT", () => {
    void stop("SIGINT");
});
process.on("SIGTERM", () => {
    void stop("SIGTERM");
});
