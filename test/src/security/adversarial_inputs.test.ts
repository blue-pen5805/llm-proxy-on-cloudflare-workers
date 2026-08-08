import { describe, it, expect } from "vitest";
import type { MiddlewareContext } from "~/src/middleware";
import { handleRouting } from "~/src/middlewares/router";
import {
  BUILT_IN_PROVIDER_CONSTRUCTORS,
  createProviderRegistry,
} from "~/src/providers";
import { ProviderRegistry } from "~/src/providers/registry";
import { handleVirtualModelsRequest } from "~/src/requests/virtual_models";
import { Config } from "~/src/utils/config";
import { Environments } from "~/src/utils/environments";
import { parseVirtualModels } from "~/src/utils/virtual_models";

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

function routingContext(body: unknown, pathname: string): MiddlewareContext {
  return {
    request: new Request(`https://proxy.example${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env: environment,
    ctx: {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext,
    pathname,
    providers: createProviderRegistry(environment),
  };
}

describe("adversarial provider selectors", () => {
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

  it("rejects an unknown top-level Responses field", async () => {
    const response = await Environments.run(environment, () =>
      handleRouting(
        routingContext(
          { model: "openai/model", input: "hi", __proto_field__: true },
          "/v1/responses",
        ),
      ),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a non-object Responses reasoning field", async () => {
    const response = await Environments.run(environment, () =>
      handleRouting(
        routingContext(
          { model: "openai/model", input: "hi", reasoning: "high" },
          "/v1/responses",
        ),
      ),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a built-in tool nested in a Responses allowed-tools choice", async () => {
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

    expect(response.status).toBe(400);
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
      } as unknown as MiddlewareContext),
    );

    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: "__proto__", access_order: [{ model: "openai/gpt-4" }] }],
    });
  });
});
