#!/usr/bin/env node

const baseUrl = required("SIGNAL_STAGING_BASE_URL").replace(/\/$/, "");
const bearerToken = required("SIGNAL_STAGING_BEARER_TOKEN");
const expectedProviders = required("SIGNAL_STAGING_EXPECTED_PROVIDERS")
  .split(",")
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);
const tenantId = process.env.SIGNAL_STAGING_TENANT_ID?.trim();

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) throw new Error(`${name} is required.`);
  return value.trim();
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${bearerToken}`,
      ...(tenantId === undefined || tenantId.length === 0
        ? {}
        : { "x-signal-tenant-id": tenantId }),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new Error(`${path} returned a non-JSON HTTP ${response.status} response.`);
  }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
  return body;
}

await request("/health");
await request("/ready");
const identity = await request("/v1/identity/configuration");
if (typeof identity.issuer !== "string" || !identity.issuer.startsWith("https://")) {
  throw new Error("Staging identity configuration is not using an HTTPS issuer.");
}

await request("/v1/ops/maintenance/run", { method: "POST", body: "{}" });
const monitored = await request("/v1/connections/monitor", { method: "POST", body: "{}" });
const connections = Array.isArray(monitored.items) ? monitored.items : [];
const missing = expectedProviders.filter(
  (provider) =>
    !connections.some(
      (connection) =>
        String(connection.provider ?? "").toLowerCase() === provider &&
        connection.status === "ACTIVE",
    ),
);
if (missing.length > 0) {
  throw new Error(`Staging lacks an active monitored connection for: ${missing.join(", ")}.`);
}

const providerHealth = await request("/v1/ops/provider-health");
const unhealthy = (Array.isArray(providerHealth.items) ? providerHealth.items : []).filter(
  (provider) =>
    expectedProviders.includes(String(provider.provider ?? "").toLowerCase()) &&
    provider.state !== "healthy",
);
if (unhealthy.length > 0) {
  throw new Error(
    `Staging provider health is not green for: ${unhealthy.map((item) => item.provider).join(", ")}.`,
  );
}

const audit = await request("/v1/ops/audit");
if (audit.chainValid !== true) throw new Error("The staging audit chain failed verification.");

console.log(
  JSON.stringify({
    status: "verified",
    providers: expectedProviders,
    activeConnections: connections.length,
    auditChainValid: true,
  }),
);
