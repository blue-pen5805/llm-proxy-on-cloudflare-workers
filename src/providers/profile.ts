import {
  DEFAULT_PROVIDER_PROFILE,
  PROVIDER_PROFILE_PATTERN,
} from "../utils/secrets";

export interface ProviderSelector {
  providerName: string;
  profile: string;
}

/** Parse `<provider>` or `<provider>:<profile>` without accepting ambiguity. */
export function parseProviderSelector(
  selector: string,
): ProviderSelector | undefined {
  const separatorIndex = selector.indexOf(":");
  if (separatorIndex === -1) {
    return selector
      ? { providerName: selector, profile: DEFAULT_PROVIDER_PROFILE }
      : undefined;
  }
  if (selector.indexOf(":", separatorIndex + 1) !== -1) return undefined;
  const providerName = selector.slice(0, separatorIndex);
  const profile = selector.slice(separatorIndex + 1);
  return providerName && PROVIDER_PROFILE_PATTERN.test(profile)
    ? { providerName, profile }
    : undefined;
}

export function formatProviderSelector(
  providerName: string,
  profile: string,
): string {
  return profile === DEFAULT_PROVIDER_PROFILE
    ? providerName
    : `${providerName}:${profile}`;
}
