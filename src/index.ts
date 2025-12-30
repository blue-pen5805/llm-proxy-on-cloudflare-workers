import { compose, MiddlewareContext } from "./middleware";
import { aiGatewayMiddleware } from "./middlewares/ai_gateway";
import { authMiddleware } from "./middlewares/auth";
import { corsMiddleware } from "./middlewares/cors";
import { envMiddleware } from "./middlewares/env";
import { errorMiddleware } from "./middlewares/error";
import { routerMiddleware } from "./middlewares/router";
// Cloudflare Durable Objects
import { KeyRotationManager } from "./utils/key_rotation_manager";

export { KeyRotationManager };

const middlewareChain = compose([
  errorMiddleware,
  envMiddleware,
  corsMiddleware,
  authMiddleware,
  aiGatewayMiddleware,
  routerMiddleware,
]);

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const context: MiddlewareContext = {
      request,
      env,
      ctx,
      pathname: "", // Will be set by authMiddleware
    };

    return await middlewareChain(context);
  },
} satisfies ExportedHandler<Env>;
