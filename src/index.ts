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
// Cloudflare Durable Objects
import { KeyRotationManager } from "./utils/key_rotation_manager";
import { RequestLogger } from "./utils/logger";

export { KeyRotationManager };

const middlewareChain = composeMiddleware([
  loggingMiddleware,
  corsMiddleware,
  errorMiddleware,
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
