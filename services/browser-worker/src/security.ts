import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import ipaddr from "ipaddr.js";

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
  try {
    return ipaddr.process(address).range() !== "unicast";
  } catch {
    return true;
  }
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
  requireTls = false,
): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Browser navigation requires HTTP or HTTPS.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("Credentials in browser URLs are forbidden.");
  }
  if (requireTls && url.protocol !== "https:") {
    throw new Error("Production browser navigation requires HTTPS.");
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
