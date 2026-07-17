import { Middleware } from "../middleware";
import { BadRequestError } from "../utils/error";

function parseIndex(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const index = Number(value);
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new BadRequestError(
      "API key index must be a non-negative safe integer.",
    );
  }
  return index;
}

export const apiKeyPathMiddleware: Middleware = async (context, next) => {
  let { pathname } = context;

  if (pathname.startsWith("/key/")) {
    const keyMatch = pathname.match(/^\/key\/([^/?#]+)(?=\/|[?#]|$)/);
    if (!keyMatch) {
      throw new BadRequestError("Invalid API key selection path.");
    }
    const selection = keyMatch[1];
    const singleMatch = selection.match(/^(\d+)$/);
    const rangeMatch = selection.match(/^(\d*)-(\d*)$/);
    if (!singleMatch && (!rangeMatch || (!rangeMatch[1] && !rangeMatch[2]))) {
      throw new BadRequestError("Invalid API key selection path.");
    }

    if (singleMatch) {
      // Single index Case: /key/i/
      context.apiKeyIndex = parseIndex(singleMatch[1]);
    } else {
      // Range Case: /key/i-j/, /key/i-/, /key/-j/
      const start = parseIndex(rangeMatch?.[1]);
      const end = parseIndex(rangeMatch?.[2]);
      if (start !== undefined && end !== undefined && start > end) {
        throw new BadRequestError(
          "API key range start must not exceed its end.",
        );
      }

      context.apiKeyIndex = {
        start,
        end,
      };
    }

    pathname = pathname.slice(keyMatch[0].length);
    // If the path becomes empty after removal (e.g., from "/key/0/"), make it "/"
    if (pathname === "") {
      pathname = "/";
    } else if (pathname.startsWith("?") || pathname.startsWith("#")) {
      pathname = `/${pathname}`;
    }
  }

  context.pathname = pathname;

  return await next();
};
