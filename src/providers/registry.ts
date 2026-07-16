import { CustomOpenAI } from "../providers/custom-openai";
import type { CustomOpenAIEndpointConfig } from "../providers/custom-openai";
import { ProviderBase } from "../providers/provider";

export type ProviderConstructor = new () => ProviderBase;

export interface ProviderRoute {
  providerName: string;
  pathname: string;
}

/**
 * Owns provider discovery and construction for a single request.
 *
 * Instances are created lazily and cached so routing, model discovery, and
 * request handlers share one consistent view of the configured providers.
 */
export class ProviderRegistry {
  private readonly builtInInstances = new Map<string, ProviderBase>();
  private readonly customInstances = new Map<
    CustomOpenAIEndpointConfig,
    CustomOpenAI
  >();
  private readonly customEndpoints: readonly CustomOpenAIEndpointConfig[];

  constructor(
    private readonly builtIns: Readonly<Record<string, ProviderConstructor>>,
    customEndpoints: readonly CustomOpenAIEndpointConfig[] = [],
  ) {
    this.customEndpoints = [...customEndpoints];
  }

  names(): string[] {
    return [
      ...new Set([
        ...Object.keys(this.builtIns),
        ...this.customEndpoints.map(({ name }) => name),
      ]),
    ];
  }

  get(providerName: string): ProviderBase | undefined {
    const existing = this.builtInInstances.get(providerName);
    if (existing) {
      return existing;
    }

    const BuiltInProvider = this.builtIns[providerName];
    const customEndpoint = this.customEndpoints.find(
      ({ name }) => name === providerName,
    );
    const provider = BuiltInProvider
      ? new BuiltInProvider()
      : customEndpoint
        ? this.getCustom(customEndpoint)
        : undefined;

    if (provider && BuiltInProvider) {
      this.builtInInstances.set(providerName, provider);
    }
    return provider;
  }

  all(): Record<string, ProviderBase> {
    const providers = Object.fromEntries(
      this.names().map((providerName) => [
        providerName,
        this.get(providerName)!,
      ]),
    );
    for (const customEndpoint of this.customEndpoints) {
      providers[customEndpoint.name] = this.getCustom(customEndpoint);
    }
    return providers;
  }

  match(pathname: string): ProviderRoute | undefined {
    const providerName = this.names().find((name) =>
      pathname.startsWith(`/${name}/`),
    );
    if (!providerName) {
      return undefined;
    }

    return {
      providerName,
      pathname: pathname.slice(providerName.length + 1),
    };
  }

  private getCustom(config: CustomOpenAIEndpointConfig): CustomOpenAI {
    let provider = this.customInstances.get(config);
    if (!provider) {
      provider = new CustomOpenAI(config);
      this.customInstances.set(config, provider);
    }
    return provider;
  }
}
