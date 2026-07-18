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

export function App() {
  const [activeNav, setActiveNav] = useState("Overview");
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["ops-overview"], queryFn: opsApi.overview });
  const tasks = useQuery({ queryKey: ["ops-tasks"], queryFn: opsApi.tasks });
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
              <small>Owner · local session</small>
            </div>
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

        {overview.isError ? (
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
