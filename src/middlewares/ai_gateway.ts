import { CloudflareAIGateway } from "../ai_gateway";
import { isSafeCloudflareAIGatewayId } from "../ai_gateway/utils";
import { Middleware } from "../middleware";
import { Config } from "../utils/config";
import { BadRequestError } from "../utils/error";

export const aiGatewayMiddleware: Middleware = async (context, next) => {
  const {
    accountId,
    name: defaultGatewayId,
    token,
    restApiToken,
  } = Config.aiGateway();

  if (context.pathname.startsWith("/g/") && accountId) {
    const pathSegments = context.pathname.split("/");
    let aiGatewayName: string;
    try {
      aiGatewayName = decodeURIComponent(pathSegments[2]);
    } catch {
      throw new BadRequestError("Invalid AI Gateway name.");
    }
    if (!isSafeCloudflareAIGatewayId(aiGatewayName)) {
      throw new BadRequestError("Invalid AI Gateway name.");
    }
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
