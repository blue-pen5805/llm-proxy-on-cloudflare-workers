import { CloudflareAIGateway } from "../ai_gateway";
import {
  isCloudflareAiPath,
  isSafeCloudflareAIGatewayId,
} from "../ai_gateway/utils";
import { Middleware } from "../middleware";
import { Config } from "../utils/config";
import { BadRequestError, ConfigurationError } from "../utils/error";

export const aiGatewayMiddleware: Middleware = async (context, next) => {
  const {
    accountId,
    name: defaultGatewayId,
    token,
    restApiToken,
    alwaysUse,
  } = Config.aiGateway();

  if (alwaysUse && !accountId) {
    throw new ConfigurationError("ALWAYS_USE_AI_GATEWAY");
  }

  if (context.pathname.startsWith("/g/") && !accountId) {
    throw new BadRequestError(
      "AI Gateway routing requires CLOUDFLARE_ACCOUNT_ID.",
    );
  }

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
      alwaysUse,
    );
  } else if (
    accountId &&
    (alwaysUse || defaultGatewayId || isCloudflareAiPath(context.pathname))
  ) {
    context.aiGateway = new CloudflareAIGateway(
      accountId,
      defaultGatewayId ?? "default",
      token,
      restApiToken,
      alwaysUse,
    );
  }

  return await next();
};
