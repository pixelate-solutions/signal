const ROUTE_HOSTS = new Set(["device-commands", "invite", "settings", "tasks"]);

export function deepLinkSegments(
  hostname: string | null | undefined,
  path: string | null | undefined,
): string[] {
  const segments = (path ?? "").split("/").filter(Boolean);
  if (
    hostname !== null &&
    hostname !== undefined &&
    ROUTE_HOSTS.has(hostname) &&
    segments[0] !== hostname
  ) {
    return [hostname, ...segments];
  }
  return segments;
}
