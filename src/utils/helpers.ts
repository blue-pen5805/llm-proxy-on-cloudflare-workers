import { AUTHORIZATION_QUERY_PARAMETERS } from "./authorization";

export const fetch2: typeof fetch = async (input, init) => {
  const url = input.toString();
  console.info(`Sub-Request: ${init?.method} ${url}`);

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

export function cleanPathname(pathname: string): string {
  let cleanedPathname = pathname;

  // Remove authorization query parameters using regex
  AUTHORIZATION_QUERY_PARAMETERS.forEach((param) => {
    // Pattern to match: &key=value or ?key=value
    const paramPattern = new RegExp(`[?&]${param}=([^&]*)`, "g");
    cleanedPathname = cleanedPathname.replace(
      paramPattern,
      (match, value, offset, str) => {
        // If it's the first parameter (?key=value), replace with ? if there are other params
        if (match.startsWith("?")) {
          // Find the next parameter after this one
          const nextAmpersand = str.indexOf("&", offset + match.length);
          if (nextAmpersand !== -1) {
            return "?";
          } else {
            return "";
          }
        }
        // If it's not the first parameter (&key=value), just remove it
        return "";
      },
    );
  });

  // Clean up any invalid query string formats like ?&param=value
  return cleanedPathname.replace(/\?\&/, "?");
}
