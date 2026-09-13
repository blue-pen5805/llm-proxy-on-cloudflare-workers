import type { ProxyMiddleware } from "../request_context";
import { getRequestPath } from "../utils/helpers";
import { RequestLogger } from "../utils/logger";

export const requestMiddleware: ProxyMiddleware = async (c, next) => {
  const context = c.get("proxy");
  // RequestLogger already parses the URL for every invocation.
  context.pathname =
    RequestLogger.requestPath() ?? getRequestPath(context.request);

  await next();
};
