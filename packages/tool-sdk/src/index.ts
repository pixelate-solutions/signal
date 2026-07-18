import type { TaskRisk, ToolExecutionContext, ToolManifest, ToolResult } from "@signal/contracts";

export type ToolCancellation = {
  signal: AbortSignal;
};

export type ToolAdapter = {
  manifest: ToolManifest;
  execute(
    input: Readonly<Record<string, unknown>>,
    context: ToolExecutionContext,
    cancellation: ToolCancellation,
  ): Promise<ToolResult>;
  verify?(
    input: Readonly<Record<string, unknown>>,
    result: ToolResult,
    context: ToolExecutionContext,
    cancellation: ToolCancellation,
  ): Promise<ToolResult>;
  compensate?(
    input: Readonly<Record<string, unknown>>,
    result: ToolResult,
    context: ToolExecutionContext,
    cancellation: ToolCancellation,
  ): Promise<ToolResult>;
};

export type CapabilityRoute = {
  tool: ToolManifest;
  connected: boolean;
  providerHealthy: boolean;
  reliability: number;
  latencyMs: number;
  costMinor: number;
  termsPermitted: boolean;
};

const sourcePreference: Record<ToolManifest["source"], number> = {
  native: 700,
  composio: 600,
  generated: 500,
  browser: 400,
  document: 380,
  sandbox: 350,
  device: 300,
  mcp: 250,
};

const riskPenalty: Record<TaskRisk, number> = {
  R0: 0,
  R1: 10,
  R2: 30,
  R3: 70,
  R4: 150,
};

export function scoreRoute(route: CapabilityRoute): number {
  if (
    !route.termsPermitted ||
    !route.providerHealthy ||
    (route.tool.auth.length > 0 && !route.connected)
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  return (
    sourcePreference[route.tool.source] +
    route.reliability * 200 -
    Math.min(route.latencyMs / 100, 50) -
    Math.min(route.costMinor, 100) -
    riskPenalty[route.tool.riskClass] +
    (route.tool.verification.mandatory ? 40 : 0)
  );
}

export function selectRoute(routes: readonly CapabilityRoute[]): CapabilityRoute | undefined {
  return routes
    .map((route) => ({ route, score: scoreRoute(route) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => right.score - left.score)[0]?.route;
}

export class ToolRegistry {
  readonly #adapters = new Map<string, ToolAdapter>();

  public register(adapter: ToolAdapter): void {
    const key = this.key(adapter.manifest.name, adapter.manifest.version);
    if (this.#adapters.has(key)) {
      throw new Error(`Tool already registered: ${key}`);
    }
    this.#adapters.set(key, adapter);
  }

  public get(name: string, version: string): ToolAdapter | undefined {
    return this.#adapters.get(this.key(name, version));
  }

  public search(query: string, limit = 8): readonly ToolManifest[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...this.#adapters.values()]
      .filter(({ manifest }) => manifest.enabled)
      .map(({ manifest }) => ({
        manifest,
        matches: terms.filter((term) =>
          `${manifest.name} ${manifest.description}`.toLowerCase().includes(term),
        ).length,
      }))
      .filter(({ matches }) => matches > 0)
      .sort((left, right) => right.matches - left.matches)
      .slice(0, limit)
      .map(({ manifest }) => manifest);
  }

  public all(): readonly ToolManifest[] {
    return [...this.#adapters.values()]
      .map(({ manifest }) => manifest)
      .filter((manifest) => manifest.enabled)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private key(name: string, version: string): string {
    return `${name}@${version}`;
  }
}

export class ToolExecutionError extends Error {
  public constructor(
    message: string,
    public readonly result: ToolResult,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}
