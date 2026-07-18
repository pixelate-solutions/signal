import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Archive,
  Blocks,
  BookOpenText,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Clock3,
  FileKey2,
  HeartPulse,
  ListTree,
  LockKeyhole,
  Radio,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Siren,
} from "lucide-react";
import { useState } from "react";

import { opsApi } from "./api";
import { useOpsAuth } from "./auth";

function decisionLabel(decision: Record<string, unknown>): string {
  const value = decision["outcome"] ?? decision["decision"];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "evaluated";
}

function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <span />
      </div>
      <div>
        <strong>SIGNAL</strong>
        <small>CONTROL</small>
      </div>
    </div>
  );
}

const navItems = [
  [CircleGauge, "Overview"],
  [ListTree, "Tasks"],
  [HeartPulse, "Providers"],
  [Blocks, "Capabilities"],
  [ShieldCheck, "Policy"],
  [ScrollText, "Audit"],
  [Siren, "Incidents"],
] as const;

function statusTone(status: string) {
  if (["COMPLETED", "loaded", "ACTIVE"].includes(status)) return "good";
  if (["FAILED", "CANCELLED"].includes(status)) return "bad";
  if (status.includes("not_configured") || status.includes("WAITING")) return "warn";
  return "info";
}

function OpsSection({ active }: { active: string }) {
  const queryClient = useQueryClient();
  const tasks = useQuery({
    queryKey: ["ops-tasks"],
    queryFn: opsApi.tasks,
    enabled: active === "Tasks",
  });
  const providers = useQuery({
    queryKey: ["ops-providers"],
    queryFn: opsApi.providers,
    enabled: active === "Providers",
  });
  const costs = useQuery({
    queryKey: ["ops-costs"],
    queryFn: opsApi.costs,
    enabled: active === "Providers",
  });
  const capabilities = useQuery({
    queryKey: ["ops-capabilities"],
    queryFn: opsApi.capabilities,
    enabled: active === "Capabilities",
  });
  const policies = useQuery({
    queryKey: ["ops-policies"],
    queryFn: opsApi.policies,
    enabled: active === "Policy",
  });
  const decisions = useQuery({
    queryKey: ["ops-policy-decisions"],
    queryFn: opsApi.policyDecisions,
    enabled: active === "Policy",
  });
  const audit = useQuery({
    queryKey: ["ops-audit"],
    queryFn: opsApi.audit,
    enabled: active === "Audit",
  });
  const evidence = useQuery({
    queryKey: ["ops-evidence"],
    queryFn: opsApi.evidence,
    enabled: active === "Audit",
  });
  const flags = useQuery({
    queryKey: ["ops-flags"],
    queryFn: opsApi.featureFlags,
    enabled: active === "Incidents",
  });
  const support = useQuery({
    queryKey: ["ops-support"],
    queryFn: opsApi.supportAccess,
    enabled: active === "Incidents",
  });
  const legalHolds = useQuery({
    queryKey: ["ops-legal-holds"],
    queryFn: opsApi.legalHolds,
    enabled: active === "Incidents",
  });
  const refresh = () => queryClient.invalidateQueries();
  const flagMutation = useMutation({
    mutationFn: ({
      view,
      enabled,
    }: {
      view: Awaited<ReturnType<typeof opsApi.featureFlags>>[number];
      enabled: boolean;
    }) => opsApi.updateFeatureFlag(view, enabled),
    onSuccess: refresh,
    onError: (error: Error) => window.alert(error.message),
  });
  const supportMutation = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => {
      const grant = support.data?.find((item) => item.id === id);
      if (grant === undefined) throw new Error("Support grant no longer exists.");
      return approve ? opsApi.approveSupportAccess(grant) : opsApi.revokeSupportAccess(id);
    },
    onSuccess: refresh,
    onError: (error: Error) => window.alert(error.message),
  });
  const maintenance = useMutation({
    mutationFn: opsApi.runMaintenance,
    onSuccess: (result) => window.alert(`Maintenance completed: ${JSON.stringify(result)}`),
    onError: (error: Error) => window.alert(error.message),
  });

  if (active === "Tasks") {
    return (
      <section className="panel section-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">DURABLE WORK</p>
            <h2>All task metadata</h2>
          </div>
          <ListTree />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>State</th>
                <th>Risk</th>
                <th>Workflow</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {(tasks.data?.items ?? []).map((task) => (
                <tr key={task.id}>
                  <td>
                    <code>{task.id}</code>
                  </td>
                  <td>
                    <span className={`badge ${statusTone(task.state)}`}>{task.state}</span>
                  </td>
                  <td>{task.risk}</td>
                  <td>
                    <code>{task.workflowId}</code>
                  </td>
                  <td>{new Date(task.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  if (active === "Providers") {
    return (
      <div className="section-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">LIVE ROUTING INPUTS</p>
              <h2>Provider health</h2>
            </div>
            <HeartPulse />
          </div>
          <div className="record-list">
            {(providers.data?.items ?? []).map((provider) => (
              <article key={provider.provider}>
                <div>
                  <strong>{provider.provider}</strong>
                  <small>
                    {provider.executions} executions · {Math.round(provider.reliability * 100)}%
                    reliable · {Math.round(provider.latencyMs)} ms
                  </small>
                </div>
                <span className={`badge ${statusTone(provider.state)}`}>
                  {provider.state} / {provider.circuit}
                </span>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">ATTRIBUTION</p>
              <h2>Recorded provider cost</h2>
            </div>
            <CircleGauge />
          </div>
          <div className="record-list">
            {Object.entries(costs.data?.byProvider ?? {}).map(([provider, value]) => (
              <article key={provider}>
                <div>
                  <strong>{provider}</strong>
                  <small>{value.executions} metered executions</small>
                </div>
                <b>${((value.costMinor + value.costMicros / 1_000_000) / 100).toFixed(4)}</b>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }
  if (active === "Capabilities") {
    return (
      <section className="panel section-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">SIGNED REGISTRY</p>
            <h2>Generated capabilities</h2>
          </div>
          <Blocks />
        </div>
        <div className="record-list">
          {(capabilities.data?.items ?? []).map((capability) => (
            <article key={capability.id}>
              <div>
                <strong>{capability.id}</strong>
                <small>
                  Version {capability.version} · updated{" "}
                  {new Date(capability.updatedAt).toLocaleString()}
                </small>
              </div>
              <span className={`badge ${statusTone(capability.status)}`}>{capability.status}</span>
            </article>
          ))}
          {(capabilities.data?.items.length ?? 0) === 0 && (
            <p className="empty">No generated capability has entered the registry.</p>
          )}
        </div>
      </section>
    );
  }
  if (active === "Policy") {
    return (
      <div className="section-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">PRECEDENCE</p>
              <h2>Stored policy bundles</h2>
            </div>
            <ShieldCheck />
          </div>
          <div className="record-list">
            {(policies.data?.items ?? []).map((bundle) => (
              <article key={bundle.id}>
                <div>
                  <strong>{bundle.scope} policy</strong>
                  <small>
                    {bundle.version} · {bundle.rules.length} rules
                  </small>
                </div>
                <span className={`badge ${bundle.active ? "good" : "warn"}`}>
                  {bundle.active ? "ACTIVE" : "INACTIVE"}
                </span>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">TRACE</p>
              <h2>Recent decisions</h2>
            </div>
            <ScrollText />
          </div>
          <div className="record-list compact">
            {(decisions.data?.items ?? [])
              .slice(-30)
              .reverse()
              .map((decision) => (
                <article key={decision.id}>
                  <div>
                    <strong>{decisionLabel(decision)}</strong>
                    <small>
                      <code>{decision.id}</code>
                    </small>
                  </div>
                </article>
              ))}
          </div>
        </section>
      </div>
    );
  }
  if (active === "Audit") {
    return (
      <div className="section-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">TAMPER EVIDENCE</p>
              <h2>Audit chain</h2>
            </div>
            <span className={`badge ${audit.data?.chainValid === true ? "good" : "bad"}`}>
              {audit.data?.chainValid === true ? "VERIFIED" : "UNVERIFIED"}
            </span>
          </div>
          <div className="record-list compact">
            {(audit.data?.items ?? [])
              .slice(-100)
              .reverse()
              .map((event) => (
                <article key={event.id}>
                  <div>
                    <strong>{event.action}</strong>
                    <small>
                      {event.actor.type}:{event.actor.id} · {event.resource.type}:
                      {event.resource.id}
                      <br />
                      {new Date(event.occurredAt).toLocaleString()}
                    </small>
                  </div>
                </article>
              ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">OUTCOME PROOF</p>
              <h2>Evidence records</h2>
            </div>
            <FileKey2 />
          </div>
          <p className="large-number">{evidence.data?.items.length ?? 0}</p>
          <small>Durable evidence records in this tenant.</small>
        </section>
      </div>
    );
  }
  return (
    <div className="section-grid incidents">
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">CONTROLLED ROLLOUT</p>
            <h2>Feature flags</h2>
          </div>
          <Radio />
        </div>
        <div className="record-list">
          {(flags.data ?? []).map((view) => (
            <article key={view.flag.key}>
              <div>
                <strong>{view.flag.key}</strong>
                <small>
                  {view.evaluation.variant} · version {view.flag.version}
                </small>
              </div>
              <button
                className="small-action"
                onClick={() => flagMutation.mutate({ view, enabled: !view.flag.enabled })}
              >
                {view.flag.enabled ? "Disable" : "Enable"}
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">JUST-IN-TIME ACCESS</p>
            <h2>Support grants</h2>
          </div>
          <LockKeyhole />
        </div>
        <div className="record-list">
          {(support.data ?? []).map((grant) => (
            <article key={grant.id}>
              <div>
                <strong>
                  {grant.ticketReference} · {grant.status}
                </strong>
                <small>
                  {grant.reason}
                  <br />
                  Scopes: {grant.requestedScopes.join(", ")}
                </small>
              </div>
              {grant.status === "REQUESTED" ? (
                <button
                  className="small-action"
                  onClick={() => supportMutation.mutate({ id: grant.id, approve: true })}
                >
                  Approve 30m
                </button>
              ) : grant.status === "APPROVED" ? (
                <button
                  className="small-action danger"
                  onClick={() => supportMutation.mutate({ id: grant.id, approve: false })}
                >
                  Revoke
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">GOVERNANCE</p>
            <h2>Legal holds and retention</h2>
          </div>
          <Archive />
        </div>
        <p className="large-number">
          {(legalHolds.data?.items ?? []).filter((hold) => hold.enabled).length}
        </p>
        <small>Active user legal holds.</small>
        <button
          className="maintenance"
          disabled={maintenance.isPending}
          onClick={() => maintenance.mutate()}
        >
          Run retention maintenance
        </button>
      </section>
    </div>
  );
}

export function App() {
  const auth = useOpsAuth();
  const [activeNav, setActiveNav] = useState("Overview");
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ["ops-overview"],
    queryFn: opsApi.overview,
    enabled: auth.status === "signed_in",
  });
  const tasks = useQuery({
    queryKey: ["ops-tasks"],
    queryFn: opsApi.tasks,
    enabled: auth.status === "signed_in",
  });
  const stop = useMutation({
    mutationFn: opsApi.emergencyStop,
    onSuccess: async ({ affectedTaskIds }) => {
      window.alert(
        `Privileged leases stopped. ${affectedTaskIds.length} task(s) moved to a safe state.`,
      );
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => window.alert(error.message),
  });
  const data = overview.data;

  if (auth.status !== "signed_in") {
    return (
      <main className="sign-in-shell">
        <section className="sign-in-card">
          <Brand />
          <p className="eyebrow">AUTHORIZED OPERATORS</p>
          <h1>Signal Control</h1>
          <p>Sign in with your organization identity. Access is role-gated and audited.</p>
          {auth.error !== null && <div className="sign-in-error">{auth.error}</div>}
          <button disabled={auth.status === "loading"} onClick={() => void auth.signIn()}>
            <LockKeyhole size={17} />
            {auth.status === "loading" ? "Loading identity…" : "Sign in with SSO"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Operator console">
          {navItems.map(([Icon, label]) => (
            <button
              key={label}
              className={activeNav === label ? "active" : ""}
              onClick={() => setActiveNav(label)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="access-card">
            <LockKeyhole size={18} />
            <div>
              <strong>Metadata view</strong>
              <small>Content requires audited JIT access</small>
            </div>
          </div>
          <div className="operator">
            <span>PO</span>
            <div>
              <strong>Platform operator</strong>
              <small>{String(auth.user?.profile["email"] ?? auth.user?.profile.sub)}</small>
            </div>
            <button className="operator-signout" onClick={() => void auth.signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <p className="eyebrow">CONTROL PLANE</p>
            <h1>{activeNav}</h1>
            <p>Operational truth without task content by default.</p>
          </div>
          <div className="header-actions">
            <button className="refresh" onClick={() => void queryClient.invalidateQueries()}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button
              className="stop"
              disabled={stop.isPending}
              onClick={() => {
                if (window.confirm("Block new privileged leases and stop all active tenant tasks?"))
                  stop.mutate();
              }}
            >
              <Siren size={16} /> Emergency stop
            </button>
          </div>
        </header>

        {activeNav !== "Overview" ? (
          <OpsSection active={activeNav} />
        ) : overview.isError ? (
          <section className="error-panel">
            <AlertTriangle />
            <div>
              <h2>Control plane unavailable</h2>
              <p>{overview.error.message}</p>
            </div>
          </section>
        ) : (
          <>
            <section className="status-strip">
              <div className="live-dot">
                <span />
                <strong>{data?.mode ?? "connecting"}</strong>
              </div>
              <p>
                Snapshot{" "}
                {data === undefined ? "pending" : new Date(data.generatedAt).toLocaleTimeString()}
              </p>
              <p>
                Policy <strong>{data?.policyBundle.version ?? "—"}</strong>
              </p>
            </section>

            <section className="metrics">
              <article>
                <div className="metric-icon teal">
                  <Activity />
                </div>
                <p>Active tasks</p>
                <strong>{data?.activeTaskCount ?? "—"}</strong>
                <small>{data?.taskCount ?? 0} total retained</small>
              </article>
              <article>
                <div className="metric-icon amber">
                  <Clock3 />
                </div>
                <p>Waiting on people</p>
                <strong>{data?.pendingActionCount ?? "—"}</strong>
                <small>Durable action requests</small>
              </article>
              <article>
                <div className="metric-icon lime">
                  <CheckCircle2 />
                </div>
                <p>Verified complete</p>
                <strong>{data?.byState["COMPLETED"] ?? "—"}</strong>
                <small>Evidence-gated outcomes</small>
              </article>
              <article>
                <div className="metric-icon violet">
                  <Boxes />
                </div>
                <p>Worker mode</p>
                <strong className="word">
                  {data?.mode === "local-development" ? "Local" : "Cloud"}
                </strong>
                <small>Truthful runtime label</small>
              </article>
            </section>

            <div className="grid">
              <section className="panel task-panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">RECENT ACTIVITY</p>
                    <h2>Task metadata</h2>
                  </div>
                  <span className="privacy">
                    <FileKey2 size={14} /> Content excluded
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>State</th>
                        <th>Risk</th>
                        <th>Events</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(tasks.data?.items ?? []).slice(0, 8).map((task) => (
                        <tr key={task.id}>
                          <td>
                            <code>{task.id.slice(0, 18)}</code>
                          </td>
                          <td>
                            <span className={`badge ${statusTone(task.state)}`}>
                              {task.state.replaceAll("_", " ")}
                            </span>
                          </td>
                          <td>{task.risk}</td>
                          <td>{task.lastSequence}</td>
                          <td>{new Date(task.updatedAt).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                      {(tasks.data?.items.length ?? 0) === 0 && (
                        <tr>
                          <td colSpan={5} className="empty">
                            No tasks have entered this tenant yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel provider-panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">DEPENDENCIES</p>
                    <h2>Provider readiness</h2>
                  </div>
                  <Radio size={19} />
                </div>
                <div className="provider-list">
                  {(data?.providers ?? []).map((provider) => (
                    <div key={provider.name}>
                      <span className={`provider-dot ${statusTone(provider.status)}`} />
                      <div>
                        <strong>{provider.name}</strong>
                        <small>{provider.status.replaceAll("_", " ")}</small>
                      </div>
                      <ChevronRight size={16} />
                    </div>
                  ))}
                </div>
                <div className="notice">
                  <AlertTriangle size={17} />
                  <p>
                    Configured means credentials exist; it does not claim a successful provider
                    probe.
                  </p>
                </div>
              </section>
            </div>

            <div className="grid lower">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">CAPABILITIES</p>
                    <h2>Generated adapter lane</h2>
                  </div>
                  <Blocks size={20} />
                </div>
                <div className="empty-cap">
                  <Archive size={28} />
                  <h3>No generated adapter deployed</h3>
                  <p>
                    New capabilities appear only after sandbox tests, signing, approval, tenant
                    canary, and runtime verification.
                  </p>
                </div>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">OPERATIONS</p>
                    <h2>Incident resources</h2>
                  </div>
                  <BookOpenText size={20} />
                </div>
                <div className="runbooks">
                  {[
                    "Emergency stop",
                    "Provider duplication risk",
                    "Browser compromise",
                    "Disaster recovery",
                  ].map((item, index) => (
                    <a href="#runbooks" key={item}>
                      <span>{index + 1}</span>
                      <strong>{item}</strong>
                      <ChevronRight size={15} />
                    </a>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
