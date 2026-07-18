import { buildApp } from "./app";
import { configFromEnv } from "./config";

const config = configFromEnv();
const app = await buildApp(config);
await app.listen({ host: "127.0.0.1", port: config.port });
app.log.info(`kiriko-server on http://127.0.0.1:${config.port}`);
