import { compose, MiddlewareContext } from "./middleware";
import { aiGatewayMiddleware } from "./middlewares/ai_gateway";
import { apiKeyPathMiddleware } from "./middlewares/api_key_path";
import { authMiddleware } from "./middlewares/auth";
import { corsMiddleware } from "./middlewares/cors";
import { errorMiddleware } from "./middlewares/error";
import { requestMiddleware } from "./middlewares/request";
import { routerMiddleware } from "./middlewares/router";
// Cloudflare Durable Objects
import { KeyRotationManager } from "./utils/key_rotation_manager";

export { KeyRotationManager };

const middlewareChain = compose([
  errorMiddleware,
  requestMiddleware,
  corsMiddleware,
  apiKeyPathMiddleware,
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
      pathname: "",
    };

    return await middlewareChain(context);
  },
} satisfies ExportedHandler<Env>;
