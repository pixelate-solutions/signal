const DEFAULT_ISSUER = "http://localhost:8080/realms/signal";
const DEFAULT_NATIVE_REDIRECT = "signal://oauth/callback";

function configuredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export function resolveOidcIssuer(
  configured: string | undefined,
  webOrigin: string | undefined,
): string {
  const explicit = configuredValue(configured);
  if (explicit !== undefined) return explicit;
  if (webOrigin !== undefined) {
    const origin = new URL(webOrigin);
    if (["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) {
      return `${origin.protocol}//${origin.hostname}:8080/realms/signal`;
    }
  }
  return DEFAULT_ISSUER;
}

export function resolveOidcRedirectUri(
  configured: string | undefined,
  webOrigin: string | undefined,
): string {
  const explicit = configuredValue(configured);
  if (webOrigin !== undefined) {
    if (explicit?.startsWith("http://") === true || explicit?.startsWith("https://") === true) {
      return explicit;
    }
    return webOrigin;
  }
  return explicit ?? DEFAULT_NATIVE_REDIRECT;
}
