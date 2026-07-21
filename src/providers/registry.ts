import { CustomOpenAI } from "../providers/custom-openai";
import type { CustomOpenAIEndpointConfig } from "../providers/custom-openai";
import {
  formatProviderSelector,
  parseProviderSelector,
} from "../providers/profile";
import { ProviderBase, withProviderProfile } from "../providers/provider";

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
  private readonly profiledInstances = new Map<string, ProviderBase>();
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
  private readonly providerNameSet: ReadonlySet<string>;

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
    this.providerNameSet = new Set(this.providerNames);
  }

  names(): string[] {
    return [...this.providerNames];
  }

  get(providerSelector: string): ProviderBase | undefined {
    const parsedSelector = parseProviderSelector(providerSelector);
    if (!parsedSelector) return undefined;
    const { providerName, profile } = parsedSelector;
    const existingProvider = this.builtInInstances.get(providerName);
    const BuiltInProvider = this.builtIns[providerName];
    const customEndpoint = this.firstCustomEndpointByName.get(providerName);
    const baseProvider =
      existingProvider ??
      (BuiltInProvider
        ? new BuiltInProvider()
        : customEndpoint
          ? this.getCustom(customEndpoint)
          : undefined);

    if (baseProvider && BuiltInProvider && !existingProvider) {
      this.builtInInstances.set(providerName, baseProvider);
    }
    if (!baseProvider) return undefined;
    if (
      profile !== "default" &&
      !baseProvider.getCredentialProfiles().includes(profile)
    ) {
      return undefined;
    }
    const existingProfiledProvider =
      this.profiledInstances.get(providerSelector);
    if (existingProfiledProvider) return existingProfiledProvider;
    const providerInstance = withProviderProfile(baseProvider, profile);
    this.profiledInstances.set(providerSelector, providerInstance);
    return providerInstance;
  }

  all(): Record<string, ProviderBase> {
    const providerInstances: Record<string, ProviderBase> = {};
    for (const providerName of this.providerNames) {
      const defaultProvider = this.get(providerName)!;
      providerInstances[providerName] = defaultProvider;
      for (const profile of defaultProvider.getCredentialProfiles()) {
        const selector = formatProviderSelector(providerName, profile);
        providerInstances[selector] = this.get(selector)!;
      }
    }
    return providerInstances;
  }

  match(pathname: string): ProviderRoute | undefined {
    // Provider names never contain "/", so the first path segment identifies
    // the route with one set lookup instead of a scan over every name.
    if (!pathname.startsWith("/")) {
      return undefined;
    }
    const separatorIndex = pathname.indexOf("/", 1);
    if (separatorIndex === -1) {
      return undefined;
    }
    const providerSelector = pathname.slice(1, separatorIndex);
    const parsedSelector = parseProviderSelector(providerSelector);
    if (
      !parsedSelector ||
      !this.providerNameSet.has(parsedSelector.providerName)
    ) {
      return undefined;
    }

    return {
      providerName: providerSelector,
      pathname: pathname.slice(separatorIndex),
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
