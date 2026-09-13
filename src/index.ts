import { Hono } from "hono";
import { aiGatewayMiddleware } from "./middlewares/ai_gateway";
import { apiKeyPathMiddleware } from "./middlewares/api_key_path";
import { authMiddleware } from "./middlewares/auth";
import { corsMiddleware } from "./middlewares/cors";
import { errorMiddleware, errorResponse } from "./middlewares/error";
import { loggingMiddleware } from "./middlewares/logging";
import { providerRegistryMiddleware } from "./middlewares/provider_registry";
import { requestMiddleware } from "./middlewares/request";
import type { ProxyEnv } from "./request_context";
import { assertRoutedRequestContext } from "./request_context";
import routes from "./routing";
import { Environments } from "./utils/environments";
import { RequestLogger } from "./utils/logger";

// Every request must enter the common boundary. Matching a constant avoids
// Hono decoding encoded line separators before its wildcard middleware runs.
// The routing application matches the authenticated, prepared path instead.
const app = new Hono<ProxyEnv>({ getPath: () => "/" });
app.onError(errorResponse);
app.use(async (c, next) => {
  c.set("proxy", {
    request: c.req.raw,
    env: c.env,
    ctx: c.executionCtx,
    pathname: "",
  });
  await Environments.run(c.env, () => RequestLogger.run(c.req.raw, next));
});
app.use(loggingMiddleware);
app.use(errorMiddleware);
app.use(corsMiddleware);
app.use(requestMiddleware);
// Authenticate before interpreting reserved prefixes or provider configuration.
app.use(authMiddleware);
app.use(apiKeyPathMiddleware);
app.use(providerRegistryMiddleware);
app.use(aiGatewayMiddleware);
app.all("*", (c) => {
  const state = c.get("proxy");
  assertRoutedRequestContext(state);
  // Route matching follows authenticated path preparation. Pass the original
  // Request and its stream without constructing or parsing another request.
  return routes.fetch(c.req.raw, state, c.executionCtx);
});

export default app;
