import { Secrets } from "./secrets";

export function authenticate(request: Request): boolean {
  if (!Secrets.isAvailable("PROXY_API_KEY")) {
    return true;
  }

  const authorizationKeys = ["Authorization", "x-api-key", "x-goog-api-key"];
  const authorizationKey =
    authorizationKeys.find((key) => {
      return Boolean(request.headers.get(key));
    }) || "";
  const authorizationValue = request.headers.get(authorizationKey);

  if (!authorizationKey || !authorizationValue) {
    return false;
  }

  const apiKey = authorizationValue.split(/\s/)[1] || authorizationValue;
  return Secrets.getAll("PROXY_API_KEY").includes(apiKey);
}
