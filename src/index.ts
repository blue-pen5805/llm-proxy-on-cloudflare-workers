import { CloudflareAIGateway } from "./ai_gateway";
import { handleRouting } from "./router";
import { authenticate } from "./utils/authorization";
import { Config } from "./utils/config";
import { Environments } from "./utils/environments";
import { cleanPathname, getPathname } from "./utils/helpers";
// Cloudflare Durable Objects
import { KeyRotationManager } from "./utils/key_rotation_manager";

export { KeyRotationManager };

export default {
  async fetch(request, _env, _ctx): Promise<Response> {
    Environments.setEnv(_env);
    if (request.method === "OPTIONS") {
      const { handleOptions } = await import("./requests/options");
      return handleOptions(request);
    }

    let pathname = cleanPathname(getPathname(request));
    if (!Config.isDevelopment() && authenticate(request) === false) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Ping
    // Example: /ping
    if (pathname === "/ping") {
      return new Response("Pong", { status: 200 });
    }

    // AI Gateway Setup
    let aiGateway: CloudflareAIGateway | undefined;
    const { accountId, name: defaultGatewayId, token } = Config.aiGateway();

    if (pathname.startsWith("/g/")) {
      const parts = pathname.split("/");
      const aiGatewayName = parts[2];
      pathname = `/${parts.slice(3).join("/")}`;

      CloudflareAIGateway.configure({
        accountId,
        gatewayId: aiGatewayName,
        apiKey: token,
      });
    } else {
      CloudflareAIGateway.configure({
        accountId,
        gatewayId: defaultGatewayId,
        apiKey: token,
      });
    }

    if (CloudflareAIGateway.isAvailable()) {
      aiGateway = new CloudflareAIGateway();
    }

    return await handleRouting(request, pathname, aiGateway);
  },
} satisfies ExportedHandler<Env>;
