export function authenticate(request: Request, env: Env): boolean {
  if (!env.PROXY_API_KEY) {
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
  return apiKey === env.PROXY_API_KEY;
}
