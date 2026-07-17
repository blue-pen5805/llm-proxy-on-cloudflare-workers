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
  private readonly firstCustomEndpointByName: ReadonlyMap<
    string,
    CustomOpenAIEndpointConfig
  >;
  private readonly providerNames: readonly string[];

  constructor(
    private readonly builtIns: Readonly<Record<string, ProviderConstructor>>,
    customEndpoints: readonly CustomOpenAIEndpointConfig[] = [],
  ) {
    this.customEndpoints = [...customEndpoints];
    const configuredNames = new Set(Object.keys(this.builtIns));
    const firstCustomEndpointByName = new Map<
      string,
      CustomOpenAIEndpointConfig
    >();
    for (const endpoint of this.customEndpoints) {
      if (configuredNames.has(endpoint.name)) {
        throw new Error(
          `Custom endpoint name is duplicated or reserved: ${endpoint.name}`,
        );
      }
      configuredNames.add(endpoint.name);
      firstCustomEndpointByName.set(endpoint.name, endpoint);
    }
    this.firstCustomEndpointByName = firstCustomEndpointByName;
    this.providerNames = [
      ...new Set([
        ...Object.keys(this.builtIns),
        ...this.customEndpoints.map(({ name }) => name),
      ]),
    ];
  }

  names(): string[] {
    return [...this.providerNames];
  }

  get(providerName: string): ProviderBase | undefined {
    const existingProvider = this.builtInInstances.get(providerName);
    if (existingProvider) {
      return existingProvider;
    }

    const BuiltInProvider = this.builtIns[providerName];
    const customEndpoint = this.firstCustomEndpointByName.get(providerName);
    const providerInstance = BuiltInProvider
      ? new BuiltInProvider()
      : customEndpoint
        ? this.getCustom(customEndpoint)
        : undefined;

    if (providerInstance && BuiltInProvider) {
      this.builtInInstances.set(providerName, providerInstance);
    }
    return providerInstance;
  }

  all(): Record<string, ProviderBase> {
    const providerInstances = Object.fromEntries(
      this.providerNames.map((providerName) => [
        providerName,
        this.get(providerName)!,
      ]),
    );
    for (const customEndpoint of this.customEndpoints) {
      providerInstances[customEndpoint.name] = this.getCustom(customEndpoint);
    }
    return providerInstances;
  }

  match(pathname: string): ProviderRoute | undefined {
    const providerName = this.providerNames.find((name) =>
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

  private getCustom(endpointConfig: CustomOpenAIEndpointConfig): CustomOpenAI {
    let providerInstance = this.customInstances.get(endpointConfig);
    if (!providerInstance) {
      providerInstance = new CustomOpenAI(endpointConfig);
      this.customInstances.set(endpointConfig, providerInstance);
    }
    return providerInstance;
  }
}
