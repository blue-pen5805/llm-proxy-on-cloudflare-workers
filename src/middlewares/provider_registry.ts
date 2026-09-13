import { createProviderRegistry } from "../providers";
import type { ProxyMiddleware } from "../request_context";

export const providerRegistryMiddleware: ProxyMiddleware = async (c, next) => {
  const context = c.get("proxy");
  context.providers ??= createProviderRegistry(context.env);
  await next();
};
