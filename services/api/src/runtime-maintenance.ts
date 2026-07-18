import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import type { ConnectionManager } from "@signal/connection-service";
import { providerHealthSchema } from "@signal/contracts";
import type { IdentityService } from "@signal/identity-service";
import type { TenantRecordStore } from "@signal/persistence";

import { CONNECTION_MANAGER, IDENTITY_SERVICE, RECORD_STORE } from "./tokens.js";

@Injectable()
export class RuntimeMaintenanceService implements OnModuleInit, OnModuleDestroy {
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<unknown> | undefined;

  public constructor(
    @Inject(RECORD_STORE) private readonly records: TenantRecordStore,
    @Inject(CONNECTION_MANAGER) private readonly connections: ConnectionManager,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  public onModuleInit(): void {
    if (process.env["NODE_ENV"] === "test") return;
    const interval = Math.max(60_000, Number(process.env["MAINTENANCE_INTERVAL_MS"] ?? 300_000));
    this.#timer = setInterval(() => void this.run(), interval);
    this.#timer.unref();
    setImmediate(() => void this.run());
  }

  public onModuleDestroy(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
  }

  public async run() {
    if (this.#running !== undefined) return this.#running;
    this.#running = this.execute();
    try {
      return await this.#running;
    } finally {
      this.#running = undefined;
    }
  }

  private async execute() {
    const monitoredConnections: Record<string, number> = {};
    const connectionCleanup: Record<string, { attempted: number; remaining: number }> = {};
    for (const tenantId of await this.records.listTenantIds()) {
      try {
        connectionCleanup[tenantId] = await this.connections.retryCleanup(tenantId);
        const connections = await this.connections.monitorTenant(tenantId);
        monitoredConnections[tenantId] = connections.length;
        const providers = new Map<string, { active: number; actionRequired: number }>();
        for (const connection of connections) {
          const summary = providers.get(connection.provider) ?? { active: 0, actionRequired: 0 };
          if (connection.status === "ACTIVE") summary.active += 1;
          if (connection.status === "ACTION_REQUIRED") summary.actionRequired += 1;
          providers.set(connection.provider, summary);
        }
        await this.records.runExclusive(tenantId, async (transaction) => {
          const probes = await transaction.list<{
            connectionId: string;
            provider: string;
            state: "healthy" | "degraded" | "action_required";
            errorClass: string | null;
            observedAt: string;
          }>("connection.health");
          for (const [provider, summary] of providers) {
            const observedAt = new Date().toISOString();
            const providerProbes = probes.filter((probe) => probe.provider === provider);
            const degraded = providerProbes.filter((probe) => probe.state === "degraded").length;
            const previous = await transaction.get<ReturnType<typeof providerHealthSchema.parse>>(
              "provider.health",
              provider,
            );
            const authorizationObserved = summary.actionRequired > 0;
            const transientOutageObserved = !authorizationObserved && degraded > 0;
            const connectionProbeWasPriorCause =
              previous?.lastErrorClass === "oauth_refresh" ||
              previous?.lastErrorClass === "provider_unavailable";
            const state = authorizationObserved
              ? summary.active > 0
                ? "degraded"
                : "unavailable"
              : transientOutageObserved
                ? "degraded"
                : connectionProbeWasPriorCause || previous === undefined
                  ? "healthy"
                  : previous.state;
            const circuit =
              authorizationObserved && summary.active === 0
                ? "open"
                : connectionProbeWasPriorCause || previous === undefined
                  ? "closed"
                  : previous.circuit;
            const executions = previous?.executions ?? summary.active + summary.actionRequired;
            const successes = previous?.successes ?? summary.active;
            await transaction.put(
              "provider.health",
              provider,
              providerHealthSchema.parse({
                provider,
                state,
                circuit,
                executions,
                successes,
                consecutiveFailures: summary.actionRequired,
                reliability:
                  previous?.reliability ?? (executions === 0 ? 0 : successes / executions),
                latencyMs: previous?.latencyMs ?? 0,
                estimatedCostMinor: previous?.estimatedCostMinor ?? 0,
                lastErrorClass: authorizationObserved
                  ? "oauth_refresh"
                  : transientOutageObserved
                    ? "provider_unavailable"
                    : connectionProbeWasPriorCause
                      ? null
                      : (previous?.lastErrorClass ?? null),
                lastObservedAt: observedAt,
                nextProbeAt:
                  circuit === "open" || transientOutageObserved
                    ? new Date(Date.now() + 300_000).toISOString()
                    : null,
              }),
            );
          }
        });
      } catch (error) {
        monitoredConnections[tenantId] = -1;
        await this.records.runExclusive(tenantId, (transaction) =>
          transaction.put("operations.maintenance-errors", `connection:${Date.now()}`, {
            component: "connection-monitor",
            error: error instanceof Error ? error.message : "Connection monitor failed.",
            occurredAt: new Date().toISOString(),
          }),
        );
      }
    }
    const governance = await this.identity.runMaintenance();
    return {
      completedAt: new Date().toISOString(),
      monitoredConnections,
      connectionCleanup,
      governance,
    };
  }
}
