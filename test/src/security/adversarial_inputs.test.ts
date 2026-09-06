import { beforeEach, describe, it, expect, vi } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import worker from "~/src/index";
import { corsMiddleware } from "~/src/middlewares/cors";
import { handleRouting } from "~/src/middlewares/router";
import {
  BUILT_IN_PROVIDER_CONSTRUCTORS,
  createProviderRegistry,
} from "~/src/providers";
import { ProviderRegistry } from "~/src/providers/registry";
import type { RoutedRequestContext } from "~/src/request_context";
import { handleChatCompletionsRequest } from "~/src/requests/chat_completions";
import { handleVirtualModelsRequest } from "~/src/requests/virtual_models";
import { resolveRoute } from "~/src/routing";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
import { parseVirtualModels } from "~/src/utils/virtual_models";
import { opencodeCatalog, opencodeCatalogUrl } from "../../helpers/opencode";
import { createTestRoutedContext } from "../../helpers/request_context";

// Names that exist on Object.prototype. A plain object used as a lookup table
// resolves them even though no provider or virtual model is configured, so
// every client-controlled lookup must reject them explicitly.
const INHERITED_KEYS = [
  "toString",
  "valueOf",
  "constructor",
  "hasOwnProperty",
  "__proto__",
  "__defineGetter__",
  "isPrototypeOf",
  "propertyIsEnumerable",
];

const environment = {
  OPENAI_API_KEY: "sk-adversarial",
} as unknown as Env;

function routingContext(body: unknown, pathname: string): RoutedRequestContext {
  return createTestRoutedContext({
    request: new Request(`https://proxy.example${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env: environment,
    pathname,
    providers: createProviderRegistry(environment),
  });
}

describe("adversarial provider selectors", () => {
  it.each([false, true])(
    "strips connection-scoped fields while retaining operator credentials (Gateway %s)",
    async (viaGateway) => {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("upstream"));
      try {
        const context = createTestRoutedContext({
          request: new Request("https://proxy.example/openai/v1/models", {
            headers: {
              authorization: "Bearer client-key",
              connection: "Authorization, X-Hop-Only, CF-AIG-Skip-Cache",
              "x-hop-only": "must-not-forward",
              "cf-aig-skip-cache": "true",
            },
          }),
          env: environment,
        });
        await Environments.run(environment, () =>
          handleRouting(
            context,
            viaGateway
              ? new CloudflareAIGateway("account", "gateway")
              : undefined,
          ),
        );
        expect(fetch).toHaveBeenCalledOnce();
        const headers = new Headers(fetch.mock.calls[0][1]?.headers);
        expect(headers.get("authorization")).toBe(
          `Bearer ${environment.OPENAI_API_KEY}`,
        );
        expect(headers.has("x-hop-only")).toBe(false);
        expect(headers.has("cf-aig-skip-cache")).toBe(false);
        expect(headers.has("connection")).toBe(false);
      } finally {
        fetch.mockRestore();
      }
    },
  );

  it.each(["https://allowed.example.attacker.invalid", "null"])(
    "withholds CORS access for origin %s even when upstream permits it",
    async (origin) => {
      const context = createTestRoutedContext({
        request: new Request("https://proxy.example/openai/v1/models", {
          headers: { Origin: origin },
        }),
      });
      const env = {
        ...context.env,
        ALLOWED_ORIGINS: '["https://allowed.example"]',
      };
      const response = await Environments.run(env, () =>
        corsMiddleware(
          context,
          async () =>
            new Response("upstream body", {
              headers: { "Access-Control-Allow-Origin": "*" },
            }),
        ),
      );
      expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
      expect(await response.text()).toBe("upstream body");
    },
  );

  it.each([
    ["invalid", 400],
    [String(10 * 1024 * 1024 + 1), 413],
  ] as const)(
    "rejects client Content-Length %s with HTTP %s before inference",
    async (contentLength, status) => {
      const context = routingContext(
        { model: "openai/model", messages: [] },
        "/v1/chat/completions",
      );
      context.request.headers.set("content-length", contentLength);
      await expect(
        Environments.run(environment, () => handleRouting(context)),
      ).rejects.toMatchObject({ status });
    },
  );

  it.each([
    "%2e%2e/chat/completions",
    "v1/.%2E/chat/completions",
    "v1/%2E./chat/completions",
    "v1/..?ignored=true",
  ])(
    "rejects Universal Endpoint traversal %s before dispatch",
    async (endpoint) => {
      const gateway = new CloudflareAIGateway("account", "gateway");
      const build = vi.spyOn(gateway, "buildUniversalEndpointRequest");
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("unexpected dispatch"));
      try {
        await expect(
          Environments.run(environment, () =>
            handleRouting(
              routingContext(
                [{ provider: "openai", endpoint, query: {} }],
                "/",
              ),
              gateway,
            ),
          ),
        ).rejects.toThrow("safe relative path");
        expect(build).not.toHaveBeenCalled();
      } finally {
        build.mockRestore();
        fetch.mockRestore();
      }
    },
  );

  it.each(INHERITED_KEYS)(
    "rejects unregistered model-list filter %s before upstream I/O",
    async (providerName) => {
      const fetch = vi.spyOn(globalThis, "fetch");
      try {
        const request = new Request(
          `https://proxy.example/v1/models?provider=${encodeURIComponent(providerName)}`,
        );
        const response = await Environments.run(environment, () =>
          handleRouting(createTestRoutedContext({ request, env: environment })),
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          error: expect.objectContaining({
            message: "Invalid provider filter.",
            param: "provider",
          }),
        });
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        fetch.mockRestore();
      }
    },
  );

  it.each(["TRACE", "CONNECT"])(
    "rejects provider pass-through method %s with 405",
    (method) => {
      const request = new Request("https://proxy.example/openai/v1/models");
      Object.defineProperty(request, "method", { value: method });
      const context = createTestRoutedContext({
        request,
        pathname: "/openai/v1/models",
        providers: createProviderRegistry(environment),
      });

      expect(() => resolveRoute(context, false)).toThrow(
        expect.objectContaining({ status: 405 }),
      );
    },
  );

  it.each(INHERITED_KEYS)(
    "does not resolve %s as a built-in provider",
    (providerName) => {
      const registry = new ProviderRegistry(BUILT_IN_PROVIDER_CONSTRUCTORS);

      expect(registry.get(providerName)).toBeUndefined();
      expect(registry.names()).not.toContain(providerName);
    },
  );

  it.each(INHERITED_KEYS)(
    "does not route /%s/... to a built-in provider",
    (providerName) => {
      const registry = new ProviderRegistry(BUILT_IN_PROVIDER_CONSTRUCTORS);

      expect(registry.match(`/${providerName}/v1/chat/completions`)).toBe(
        undefined,
      );
    },
  );

  it.each(INHERITED_KEYS)(
    "rejects the model %s/x on chat completions with 400",
    async (providerName) => {
      const response = await Environments.run(environment, () =>
        handleRouting(
          routingContext(
            {
              model: `${providerName}/some-model`,
              messages: [{ role: "user", content: "hi" }],
            },
            "/v1/chat/completions",
          ),
        ),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: expect.objectContaining({ message: "Invalid provider." }),
      });
    },
  );

  it.each(INHERITED_KEYS)(
    "rejects the credential profile openai:%s with 400",
    async (profile) => {
      const response = await Environments.run(environment, () =>
        handleRouting(
          routingContext(
            {
              model: `openai:${profile}/gpt-4`,
              messages: [{ role: "user", content: "hi" }],
            },
            "/v1/chat/completions",
          ),
        ),
      );

      expect(response.status).toBe(400);
    },
  );

  it("rejects an inherited provider name on the Responses route", async () => {
    const response = await Environments.run(environment, () =>
      handleRouting(
        routingContext({ model: "toString/x", input: "hi" }, "/v1/responses"),
      ),
    );

    expect(response.status).toBe(400);
  });

  it("does not reject an unknown top-level Responses field as malformed", async () => {
    const response = await Environments.run(environment, () =>
      handleRouting(
        routingContext(
          { model: "openai/model", input: "hi", __proto_field__: true },
          "/v1/responses",
        ),
      ),
    );

    expect(response.status).toBe(401);
  });

  it("rejects a non-object Responses reasoning field during Chat conversion", async () => {
    const response = await Environments.run(environment, () =>
      handleRouting(
        routingContext(
          { model: "cerebras/model", input: "hi", reasoning: "high" },
          "/v1/responses",
        ),
      ),
    );

    expect(response.status).toBe(400);
  });

  it("ignores a built-in tool nested in a Responses allowed-tools choice", async () => {
    const response = await Environments.run(environment, () =>
      handleRouting(
        routingContext(
          {
            model: "openai/model",
            input: "hi",
            tool_choice: {
              type: "allowed_tools",
              mode: "auto",
              tools: [{ type: "web_search" }],
            },
          },
          "/v1/responses",
        ),
      ),
    );

    expect(response.status).toBe(401);
  });

  it("ignores an unsupported Responses prompt-cache breakpoint", async () => {
    const response = await Environments.run(environment, () =>
      handleRouting(
        routingContext(
          {
            model: "openai/model",
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: "hi",
                    prompt_cache_breakpoint: { mode: "implicit" },
                  },
                ],
              },
            ],
          },
          "/v1/responses",
        ),
      ),
    );

    expect(response.status).toBe(401);
  });

  it("rejects an inherited provider name on the Messages route", async () => {
    const response = await Environments.run(environment, () =>
      handleRouting(
        routingContext(
          {
            model: "constructor/x",
            max_tokens: 8,
            messages: [{ role: "user", content: "hi" }],
          },
          "/v1/messages",
        ),
      ),
    );

    expect(response.status).toBe(400);
  });

  it.each(["system", "user"])(
    "rejects malformed nested %s instructions before dispatch",
    async (role) => {
      const fetch = vi.spyOn(globalThis, "fetch");
      try {
        const response = await Environments.run(environment, () =>
          handleRouting(
            routingContext(
              {
                model: "openai/model",
                max_tokens: 8,
                messages: [
                  {
                    role,
                    content: [
                      {
                        type: "mid_conv_system",
                        content: { text: "untrusted" },
                      },
                    ],
                  },
                ],
              },
              "/v1/messages",
            ),
          ),
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: {
            type: "invalid_request_error",
            message: expect.stringContaining("messages.content.system.content"),
          },
        });
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        fetch.mockRestore();
      }
    },
  );

  it("ignores an unsupported field in a Messages system block", async () => {
    const response = await Environments.run(environment, () =>
      handleRouting(
        routingContext(
          {
            model: "openai/model",
            max_tokens: 8,
            messages: [
              {
                role: "system",
                content: [{ type: "text", text: "hi", untrusted: true }],
              },
            ],
          },
          "/v1/messages",
        ),
      ),
    );

    expect(response.status).toBe(401);
  });
});

describe("adversarial virtual model keys", () => {
  const virtualEnvironment = {
    ...environment,
    VIRTUAL_MODELS: JSON.stringify({ "virtual/fast": ["openai/gpt-4"] }),
  } as unknown as Env;

  it.each(INHERITED_KEYS)(
    "does not treat %s as a configured virtual model",
    async (modelName) => {
      const response = await Environments.run(virtualEnvironment, () =>
        handleRouting(
          routingContext(
            { model: modelName, messages: [{ role: "user", content: "hi" }] },
            "/v1/chat/completions",
          ),
        ),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: expect.objectContaining({ message: "Invalid provider." }),
      });
    },
  );

  it("keeps a __proto__ key as an ordinary configured entry", () => {
    const parsed = parseVirtualModels(
      JSON.parse('{"__proto__":["openai/gpt-4"],"virtual/a":["openai/gpt-5"]}'),
    );

    expect(Object.keys(parsed!)).toEqual(["__proto__", "virtual/a"]);
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(parsed!["__proto__"]).toEqual([
      { model: "openai/gpt-4", retries: 0 },
    ]);
  });

  it("lists a __proto__ virtual model without corrupting the map", () => {
    const listed = Environments.run(
      {
        ...environment,
        VIRTUAL_MODELS: '{"__proto__":["openai/gpt-4"]}',
      } as unknown as Env,
      () => Config.virtualModels(),
    );

    expect(Object.keys(listed!)).toEqual(["__proto__"]);
  });

  it("expands the access order of a __proto__ virtual model", async () => {
    const proxyEnvironment = {
      ...environment,
      VIRTUAL_MODELS: '{"__proto__":["openai/gpt-4"]}',
    } as unknown as Env;
    const response = await Environments.run(proxyEnvironment, () =>
      handleVirtualModelsRequest({
        request: new Request("https://proxy.example/virtual-models"),
        env: proxyEnvironment,
        pathname: "/virtual-models",
        providers: createProviderRegistry(proxyEnvironment),
      } as unknown as RoutedRequestContext),
    );

    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: "__proto__", access_order: [{ model: "openai/gpt-4" }] }],
    });
  });
});

describe("direct Bedrock model paths", () => {
  it.each(["", ".", ".."])(
    "rejects the path segment %j before dispatch",
    async (model) => {
      const fetch = vi.spyOn(globalThis, "fetch");
      try {
        await Environments.runWithConfig(
          {
            AWS_BEARER_TOKEN_BEDROCK: "example-key",
            AWS_BEDROCK_REGION: "us-east-1",
          },
          async () => {
            const state = routingContext(
              { model: `aws-bedrock/${model}`, messages: [] },
              "/v1/chat/completions",
            );
            await expect(
              handleChatCompletionsRequest(state),
            ).rejects.toMatchObject({
              status: 400,
              message: "Invalid Bedrock model identifier.",
            });
          },
        );
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        fetch.mockRestore();
      }
    },
  );
});

describe("custom native API path configuration", () => {
  it.each(["responsesPath", "messagesPath"])(
    "rejects origin URLs in %s without echoing configuration",
    (field) => {
      for (const path of ["https://other.example/api", "//other.example/api"]) {
        Environments.runWithConfig(
          {
            CUSTOM_OPENAI_ENDPOINTS: [
              {
                name: "custom",
                baseUrl: "https://upstream.example",
                [field]: path,
              },
            ],
          },
          () => {
            expect(() => Config.customOpenAIEndpoints()).toThrow(
              "Invalid configuration for CUSTOM_OPENAI_ENDPOINTS.",
            );
          },
        );
      }
    },
  );
});

describe("matching API model boundaries", () => {
  it("keeps a URL-shaped Perplexity model inside the fixed upstream request body", async () => {
    const { handleResponsesRequest } = await import("~/src/requests/responses");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ error: "unsupported model" }, { status: 400 }),
      );
    try {
      await Environments.runWithConfig(
        { PERPLEXITYAI_API_KEY: "example-key" },
        async () => {
          const model = "https://untrusted.example/../responses?key=value";
          const response = await handleResponsesRequest(
            routingContext(
              { model: `perplexity-ai/${model}`, input: "hello" },
              "/v1/responses",
            ),
          );
          expect(response.status).toBe(400);
          expect(String(fetch.mock.lastCall![0])).toBe(
            "https://api.perplexity.ai/v1/responses",
          );
          expect(JSON.parse(String(fetch.mock.lastCall![1]!.body)).model).toBe(
            model,
          );
          expect(fetch).toHaveBeenCalledOnce();
        },
      );
    } finally {
      fetch.mockRestore();
    }
  });
});

describe("OpenCode catalog security boundary", () => {
  beforeEach(async () => {
    const cache = await caches.open("llm-proxy-opencode-protocol-v1");
    await cache.delete(opencodeCatalogUrl);
  });

  it.each([
    "constructor",
    "__proto__",
    "toString",
    "../responses?api_key=untrusted",
    "https://untrusted.example/model",
  ])("rejects unregistered model %s before inference", async (model) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(opencodeCatalog()));
    try {
      const context = createTestRoutedContext({
        request: new Request("https://proxy.example/v1/chat/completions", {
          method: "POST",
          headers: { authorization: "Bearer example-proxy-key" },
          body: JSON.stringify({
            model: `opencode-zen/${model}`,
            messages: [{ role: "user", content: "hello" }],
          }),
        }),
      });
      const response = await worker.fetch(
        new Request<unknown, IncomingRequestCfProperties>(context.request),
        {
          ...context.env,
          PROXY_API_KEY: "example-proxy-key",
          OPENCODE_API_KEY: "example-provider-key",
        },
        context.ctx,
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Unknown OpenCode model");
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][0]).toBe(opencodeCatalogUrl);
      expect(new Headers(fetch.mock.calls[0][1]?.headers)).toEqual(
        new Headers({ accept: "application/json" }),
      );
    } finally {
      fetch.mockRestore();
    }
  });

  it("rejects unsupported Responses conversion fields without sending an inference body", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(opencodeCatalog()));
    try {
      const context = createTestRoutedContext({
        request: new Request("https://proxy.example/v1/chat/completions", {
          method: "POST",
          headers: { authorization: "Bearer example-proxy-key" },
          body: JSON.stringify({
            model: "opencode-zen/responses",
            messages: [{ role: "user", content: "hello" }],
            unrecognized: true,
          }),
        }),
      });
      const response = await worker.fetch(
        new Request<unknown, IncomingRequestCfProperties>(context.request),
        {
          ...context.env,
          PROXY_API_KEY: "example-proxy-key",
          OPENCODE_API_KEY: "example-provider-key",
        },
        context.ctx,
      );
      expect(response.status).toBe(400);
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][1]?.body).toBeUndefined();
    } finally {
      fetch.mockRestore();
    }
  });

  it.each(["constructor", "@ai-sdk/unknown"])(
    "fails closed for unrecognized catalog SDK %s",
    async (npm) => {
      const catalog = opencodeCatalog();
      catalog.opencode.npm = npm;
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json(catalog));
      try {
        const context = createTestRoutedContext({
          request: new Request("https://proxy.example/v1/chat/completions", {
            method: "POST",
            headers: { authorization: "Bearer example-proxy-key" },
            body: JSON.stringify({ model: "opencode-zen/chat", messages: [] }),
          }),
        });
        const response = await worker.fetch(
          new Request<unknown, IncomingRequestCfProperties>(context.request),
          {
            ...context.env,
            PROXY_API_KEY: "example-proxy-key",
            OPENCODE_API_KEY: "example-provider-key",
          },
          context.ctx,
        );
        expect(response.status).toBe(502);
        expect(await response.text()).not.toContain(npm);
        expect(fetch).toHaveBeenCalledOnce();
      } finally {
        fetch.mockRestore();
      }
    },
  );
});
