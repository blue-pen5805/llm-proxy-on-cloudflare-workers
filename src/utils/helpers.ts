export function maskUrl(url: string): string {
  // Constants for masking behavior
  const MASK_THRESHOLD = 10; // Minimum length to show prefix
  const MASK_PREFIX_LENGTH = 3; // Number of characters to show before masking
  const MASK_PLACEHOLDER = "***";

  // List of sensitive parameter names that should be masked
  const sensitiveParams = [
    "apikey",
    "api_key",
    "token",
    "access_token",
    "accesstoken",
    "auth",
    "authorization",
    "password",
    "secret",
    "key",
    "api-key",
  ];

  try {
    const urlObj = new URL(url);

    // Mask only sensitive query parameters
    if (urlObj.search) {
      const params = new URLSearchParams(urlObj.search);
      const maskedParams = new URLSearchParams();

      for (const [key, value] of params.entries()) {
        const keyLower = key.toLowerCase();
        const isSensitive = sensitiveParams.some((param) => keyLower === param);

        if (isSensitive) {
          // Mask the value, keeping prefix for longer values
          if (value.length > MASK_THRESHOLD) {
            maskedParams.set(
              key,
              `${value.slice(0, MASK_PREFIX_LENGTH)}${MASK_PLACEHOLDER}`,
            );
          } else if (value.length > 0) {
            maskedParams.set(key, MASK_PLACEHOLDER);
          } else {
            maskedParams.set(key, value);
          }
        } else {
          // Keep non-sensitive parameters as-is
          maskedParams.set(key, value);
        }
      }

      urlObj.search = maskedParams.toString();
    }

    return urlObj.toString();
  } catch {
    // If URL parsing fails, return masked version
    const MASK_PLACEHOLDER = "***";
    return (
      url.split("?")[0] + (url.includes("?") ? `?${MASK_PLACEHOLDER}` : "")
    );
  }
}

export const fetch2: typeof fetch = async (input, init) => {
  const url = input.toString();
  // URL is masked to prevent exposing sensitive data like API keys
  const maskedUrl = maskUrl(url);
  console.info(`Sub-Request: ${init?.method} ${maskedUrl}`);

  return await fetch(input, init);
};

export function safeJsonParse(text: string): string | { [key: string]: any } {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function getPathname(request: Request): string {
  return request.url.replace(new URL(request.url).origin, "");
}

export function shuffleArray<T>(array: T[]): T[] {
  const cloneArray = [...array];

  for (let i = cloneArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloneArray[i], cloneArray[j]] = [cloneArray[j], cloneArray[i]];
  }

  return cloneArray;
}

export function formatString(
  template: string,
  args: { [key: string]: string },
): string {
  return Object.keys(args).reduce((formattedString: string, key) => {
    const regExp = new RegExp(`\\{${key}\\}`, "g");
    return formattedString.replace(regExp, args[key]);
  }, template);
}
