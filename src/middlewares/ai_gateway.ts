import { CloudflareAIGateway } from "../ai_gateway";
import { Middleware } from "../middleware";
import { Config } from "../utils/config";

export const aiGatewayMiddleware: Middleware = async (context, next) => {
  const {
    accountId,
    name: defaultGatewayId,
    token,
    restApiToken,
  } = Config.aiGateway();

  if (context.pathname.startsWith("/g/") && accountId) {
    const pathSegments = context.pathname.split("/");
    const aiGatewayName = pathSegments[2];
    context.pathname = `/${pathSegments.slice(3).join("/")}`;

    context.aiGateway = new CloudflareAIGateway(
      accountId,
      aiGatewayName,
      token,
      restApiToken,
    );
  } else if (
    accountId &&
    (defaultGatewayId || /^\/ai(?:$|\/|\?)/.test(context.pathname))
  ) {
    context.aiGateway = new CloudflareAIGateway(
      accountId,
      defaultGatewayId ?? "default",
      token,
      restApiToken,
    );
  }

  return await next();
};
