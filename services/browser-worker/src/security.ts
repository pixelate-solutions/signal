import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const injectionPatterns = [
  /ignore (?:all )?(?:previous|prior|system|developer) instructions/i,
  /reveal|exfiltrate|send|upload[\s\S]{0,60}(?:secret|credential|token|cookie|password)/i,
  /(?:grant|give) (?:me|this page)[\s\S]{0,30}(?:access|permission|tools?)/i,
  /call (?:an? )?(?:unrelated )?tool/i,
  /you are now (?:authorized|an administrator|root)/i,
];

type AddressResolver = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<readonly { address: string; family: number }[]>;

const defaultResolver: AddressResolver = async (hostname, options) => lookup(hostname, options);

function isPrivateAddress(address: string): boolean {
  if (address === "::1" || address === "0.0.0.0" || address === "::") return true;
  if (address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:"))
    return true;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export function domainAllowed(hostname: string, allowlist: readonly string[]): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return allowlist.some((entry) => {
    const allowed = entry.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}

export async function assertSafeBrowserUrl(
  rawUrl: string,
  allowlist: readonly string[],
  resolver: AddressResolver = defaultResolver,
): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Browser navigation requires HTTP or HTTPS.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("Credentials in browser URLs are forbidden.");
  }
  if (!domainAllowed(url.hostname, allowlist)) {
    throw new Error("Browser egress policy denied the target domain.");
  }
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await resolver(url.hostname, { all: true, verbatim: true });
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Browser SSRF policy denied a private or reserved address.");
  }
  return url;
}

export function detectPromptInjection(content: string): {
  blocked: boolean;
  indicators: string[];
} {
  const indicators = injectionPatterns
    .filter((pattern) => pattern.test(content))
    .map((pattern) => pattern.source);
  return { blocked: indicators.length > 0, indicators };
}
