import { Middleware } from "../middleware";

export const apiKeyPathMiddleware: Middleware = async (context, next) => {
  let { pathname } = context;

  // Extract /key/i/, /key/i-j/, /key/i-/, or /key/-j/ from pathname
  const keyMatch = pathname.match(/^\/key\/(?:(\d+)?-(\d+)?|(\d+))/);
  if (keyMatch) {
    if (keyMatch[3] !== undefined) {
      // Single index Case: /key/i/
      context.apiKeyIndex = parseInt(keyMatch[3], 10);
    } else {
      // Range Case: /key/i-j/, /key/i-/, /key/-j/
      const startStr = keyMatch[1];
      const endStr = keyMatch[2];

      context.apiKeyIndex = {
        start: startStr !== undefined ? parseInt(startStr, 10) : undefined,
        end: endStr === undefined ? undefined : parseInt(endStr, 10),
      };
    }

    pathname = pathname.replace(/^\/key\/[^/]+/, "");
    // If the path becomes empty after removal (e.g., from "/key/0/"), make it "/"
    if (pathname === "") {
      pathname = "/";
    }
  }

  context.pathname = pathname;

  return await next();
};
