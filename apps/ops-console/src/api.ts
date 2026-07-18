const apiBase =
  (import.meta.env["VITE_SIGNAL_API_URL"] as string | undefined)?.replace(/\/$/, "") ?? "";
import { getOpsAccessToken } from "./auth";

export type OpsOverview = {
  generatedAt: string;
  mode: string;
  taskCount: number;
  activeTaskCount: number;
  pendingActionCount: number;
  byState: Record<string, number>;
  providers: {
    name: string;
    status: string;
  }[];
  policyBundle: { version: string; status: string };
};

export type OpsTask = {
  id: string;
  state: string;
  risk: string;
  lastSequence: number;
  workflowId: string;
  createdAt: string;
  updatedAt: string;
};

export type ProviderHealth = {
  provider: string;
  state: string;
  circuit: string;
  executions: number;
  successes: number;
  reliability: number;
  latencyMs: number;
  consecutiveFailures: number;
  estimatedCostMinor: number;
  lastErrorClass: string | null;
  lastObservedAt: string;
  nextProbeAt: string | null;
};

export type FeatureFlagView = {
  flag: {
    key: string;
    enabled: boolean;
    defaultVariant: string;
    rules: unknown[];
    metadata: Record<string, unknown>;
    version: number;
    updatedAt: string;
  };
  evaluation: { enabled: boolean; variant: string; ruleId: string | null };
};

export type SupportGrant = {
  id: string;
  operatorUserId: string;
  delegatedUserId: string;
  reason: string;
  ticketReference: string;
  requestedScopes: string[];
  grantedScopes: string[];
  status: string;
  expiresAt: string;
};

export type PolicyBundle = {
  id: string;
  scope: string;
  version: string;
  active: boolean;
  rules: unknown[];
  updatedAt: string;
};

export type AuditEvent = {
  id: string;
  action: string;
  actor: { type: string; id: string };
  resource: { type: string; id: string };
  eventDigest: string;
  occurredAt: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const token = await getOpsAccessToken();
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Control plane returned ${response.status}.`);
  }
  return (await response.json()) as T;
}

export const opsApi = {
  overview: () => request<OpsOverview>("/v1/ops/overview"),
  tasks: () => request<{ items: OpsTask[]; contentIncluded: false }>("/v1/ops/tasks"),
  providers: () => request<{ items: ProviderHealth[] }>("/v1/ops/provider-health"),
  costs: () =>
    request<{
      currency: string;
      byProvider: Record<string, { costMinor: number; costMicros: number; executions: number }>;
    }>("/v1/ops/costs"),
  capabilities: () =>
    request<{ items: { id: string; status: string; version: string; updatedAt: string }[] }>(
      "/v1/developer/capabilities",
    ),
  policies: () => request<{ items: PolicyBundle[] }>("/v1/policies"),
  policyDecisions: () =>
    request<{ items: (Record<string, unknown> & { id: string })[] }>("/v1/policies/decisions"),
  audit: () => request<{ items: AuditEvent[]; chainValid: boolean }>("/v1/ops/audit"),
  evidence: () => request<{ items: Record<string, unknown>[] }>("/v1/ops/evidence"),
  featureFlags: () => request<FeatureFlagView[]>("/v1/ops/feature-flags"),
  updateFeatureFlag: (view: FeatureFlagView, enabled: boolean) =>
    request(`/v1/ops/feature-flags/${encodeURIComponent(view.flag.key)}`, {
      method: "PUT",
      body: JSON.stringify({
        enabled,
        defaultVariant: view.flag.defaultVariant,
        rules: view.flag.rules,
        metadata: view.flag.metadata,
        expectedVersion: view.flag.version,
      }),
    }),
  supportAccess: () => request<SupportGrant[]>("/v1/ops/support-access"),
  approveSupportAccess: (grant: SupportGrant) =>
    request<SupportGrant>(`/v1/ops/support-access/${encodeURIComponent(grant.id)}/approve`, {
      method: "POST",
      body: JSON.stringify({ grantedScopes: grant.requestedScopes, durationMinutes: 30 }),
    }),
  revokeSupportAccess: (id: string) =>
    request<SupportGrant>(`/v1/ops/support-access/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  legalHolds: () =>
    request<{
      items: { userId: string; enabled: boolean; reason: string; updatedAt: string }[];
    }>("/v1/ops/legal-holds"),
  runMaintenance: () =>
    request<Record<string, unknown>>("/v1/ops/maintenance/run", { method: "POST" }),
  emergencyStop: () =>
    request<{ stopped: boolean; affectedTaskIds: string[] }>("/v1/security/emergency-stop", {
      method: "POST",
      body: JSON.stringify({ reason: "Emergency stop initiated from Signal Control." }),
    }),
};
