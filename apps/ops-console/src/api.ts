const apiBase =
  (import.meta.env["VITE_SIGNAL_API_URL"] as string | undefined)?.replace(/\/$/, "") ?? "";
const token = import.meta.env["VITE_SIGNAL_API_TOKEN"] as string | undefined;

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
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
  emergencyStop: () =>
    request<{ stopped: boolean; affectedTaskIds: string[] }>("/v1/security/emergency-stop", {
      method: "POST",
      body: JSON.stringify({ reason: "Emergency stop initiated from Signal Control." }),
    }),
};
