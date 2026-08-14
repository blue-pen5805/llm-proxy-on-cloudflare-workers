import { createExecutionContext, env } from "cloudflare:test";
import {
  BUILT_IN_PROVIDER_CONSTRUCTORS,
  ProviderRegistry,
} from "~/src/providers";
import type { RoutedRequestContext } from "~/src/request_context";
import { getRequestPath } from "~/src/utils/helpers";

const defaultTestEnv: Env = {
  ...env,
  TEST_VAR: "",
  JSON_OBJECT: "",
  JSON_ARRAY: "",
  JSON_NUMBER: "",
  JSON_LITERAL: "",
  QUOTED_STRING: "",
  MALFORMED_ARRAY: "",
  COMMA_SEPARATED: "",
  PLAIN_STRING: "",
};

/** Build complete request state for tests that enter at the routing boundary. */
export function createTestRoutedContext(
  overrides: Partial<RoutedRequestContext> = {},
): RoutedRequestContext {
  const request =
    overrides.request ?? new Request("https://proxy.example.invalid/");

  return {
    request,
    env: overrides.env ?? defaultTestEnv,
    ctx: overrides.ctx ?? createExecutionContext(),
    pathname: overrides.pathname ?? getRequestPath(request),
    providers:
      overrides.providers ??
      new ProviderRegistry(BUILT_IN_PROVIDER_CONSTRUCTORS),
    ...(overrides.aiGateway === undefined
      ? {}
      : { aiGateway: overrides.aiGateway }),
    ...(overrides.apiKeyIndex === undefined
      ? {}
      : { apiKeyIndex: overrides.apiKeyIndex }),
    ...(overrides.proxyKeyIndex === undefined
      ? {}
      : { proxyKeyIndex: overrides.proxyKeyIndex }),
  };
}
