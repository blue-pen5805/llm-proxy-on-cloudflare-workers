import { composeMiddleware, MiddlewareContext } from "./middleware";
import { aiGatewayMiddleware } from "./middlewares/ai_gateway";
import { apiKeyPathMiddleware } from "./middlewares/api_key_path";
import { authMiddleware } from "./middlewares/auth";
import { corsMiddleware } from "./middlewares/cors";
import { errorMiddleware } from "./middlewares/error";
import { loggingMiddleware } from "./middlewares/logging";
import { providerRegistryMiddleware } from "./middlewares/provider_registry";
import { requestMiddleware } from "./middlewares/request";
import { routerMiddleware } from "./middlewares/router";
import { Environments } from "./utils/environments";
import { RequestLogger } from "./utils/logger";

// errorMiddleware wraps corsMiddleware so a failure inside CORS handling still
// produces a JSON error response instead of an uncaught Worker exception. It
// applies the CORS headers to its own responses to keep browser clients able to
// read proxy errors.
const middlewareChain = composeMiddleware([
  loggingMiddleware,
  errorMiddleware,
  corsMiddleware,
  requestMiddleware,
  apiKeyPathMiddleware,
  authMiddleware,
  providerRegistryMiddleware,
  aiGatewayMiddleware,
  routerMiddleware,
]);

export default {
  async fetch(request, env, ctx): Promise<Response> {
    return Environments.run(env, () =>
      RequestLogger.run(request, () => {
        const middlewareContext: MiddlewareContext = {
          request,
          env,
          ctx,
          pathname: "",
        };

        return middlewareChain(middlewareContext);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
