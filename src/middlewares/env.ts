import { Middleware } from "../middleware";
import { Environments } from "../utils/environments";

export const envMiddleware: Middleware = async (context, next) => {
  Environments.setEnv(context.env);
  return await next();
};
