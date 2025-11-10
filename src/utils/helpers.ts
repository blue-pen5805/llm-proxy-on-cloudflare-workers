export function maskUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Mask query parameters
    if (urlObj.search) {
      const params = new URLSearchParams(urlObj.search);
      const maskedParams = new URLSearchParams();

      for (const [key, value] of params.entries()) {
        // Mask the value, keeping first 3 chars if longer than 10 chars
        if (value.length > 10) {
          maskedParams.set(key, `${value.slice(0, 3)}***`);
        } else if (value.length > 0) {
          maskedParams.set(key, "***");
        } else {
          maskedParams.set(key, value);
        }
      }

      urlObj.search = maskedParams.toString();
    }

    return urlObj.toString();
  } catch {
    // If URL parsing fails, return masked version
    return url.split("?")[0] + (url.includes("?") ? "?***" : "");
  }
}

export const fetch2: typeof fetch = async (input, init) => {
  const url = input.toString();
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
