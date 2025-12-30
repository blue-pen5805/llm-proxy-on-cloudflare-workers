import { CloudflareAIGateway } from "../ai_gateway";
import { Middleware } from "../middleware";
import { Config } from "../utils/config";

export const aiGatewayMiddleware: Middleware = async (context, next) => {
  const { accountId, name: defaultGatewayId, token } = Config.aiGateway();

  if (context.pathname.startsWith("/g/") && accountId) {
    const parts = context.pathname.split("/");
    const aiGatewayName = parts[2];
    context.pathname = `/${parts.slice(3).join("/")}`;

    context.aiGateway = new CloudflareAIGateway(
      accountId,
      aiGatewayName,
      token,
    );
  } else if (accountId && defaultGatewayId) {
    context.aiGateway = new CloudflareAIGateway(
      accountId,
      defaultGatewayId,
      token,
    );
  }

  return await next();
};
