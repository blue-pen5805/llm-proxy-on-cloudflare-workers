import { Middleware } from "../middleware";
import { createProviderRegistry } from "../providers";

export const providerRegistryMiddleware: Middleware = async (context, next) => {
  context.providers ??= createProviderRegistry(context.env);
  return await next();
};
