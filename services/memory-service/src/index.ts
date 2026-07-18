import { randomUUID } from "node:crypto";

import type { Principal } from "@signal/auth-sdk";
import { requireTenant } from "@signal/auth-sdk";
import { createMemorySchema, updateMemorySchema, type MemoryItem } from "@signal/contracts";
import { assertMemorySafe, rankMemories, type MemoryQuery } from "@signal/memory-sdk";

export class MemoryNotFoundError extends Error {
  public constructor() {
    super("Memory item not found.");
    this.name = "MemoryNotFoundError";
  }
}

export class MemoryService {
  readonly #items = new Map<string, MemoryItem>();
  readonly #derivedKeys = new Map<string, Set<string>>();

  public constructor(private readonly now: () => Date = () => new Date()) {}

  public list(principal: Principal, includeHistory = false): MemoryItem[] {
    return [...this.#items.values()]
      .filter(
        (item) =>
          item.tenantId === principal.tenantId &&
          item.userId === principal.userId &&
          (includeHistory || item.status === "active" || item.status === "proposed"),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public create(principal: Principal, rawInput: unknown): MemoryItem {
    const input = createMemorySchema.parse(rawInput);
    assertMemorySafe(input.canonicalText, input.object);
    const now = this.now().toISOString();
    for (const current of this.#items.values()) {
      if (
        current.tenantId === principal.tenantId &&
        current.userId === principal.userId &&
        current.scope.type === input.scope.type &&
        current.scope.id === input.scope.id &&
        current.subject === input.subject &&
        current.predicate === input.predicate &&
        current.status === "active"
      ) {
        this.#items.set(current.id, {
          ...current,
          status: "superseded",
          validTo: now,
          updatedAt: now,
        });
      }
    }
    const item: MemoryItem = {
      id: `mem_${randomUUID().replaceAll("-", "")}`,
      tenantId: principal.tenantId,
      userId: principal.userId,
      kind: input.kind,
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      canonicalText: input.canonicalText,
      scope: input.scope,
      explicitness: input.explicitness,
      confidence: input.confidence,
      sensitivity: input.sensitivity,
      validFrom: input.validFrom,
      validTo: input.validTo,
      expiresAt: input.expiresAt,
      status: "active",
      pinned: false,
      sourceIds: input.sourceIds,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    };
    this.#items.set(item.id, item);
    this.#derivedKeys.set(item.id, new Set([`vector:${item.id}`, `graph:${item.id}`]));
    return item;
  }

  public update(principal: Principal, id: string, rawInput: unknown): MemoryItem {
    const patch = updateMemorySchema.parse(rawInput);
    const current = this.require(principal, id);
    const materialChange =
      patch.object !== undefined ||
      patch.canonicalText !== undefined ||
      patch.scope !== undefined ||
      patch.expiresAt !== undefined;
    if (!materialChange) {
      const updated: MemoryItem = {
        ...current,
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
        updatedAt: this.now().toISOString(),
      };
      this.#items.set(id, updated);
      return updated;
    }
    const canonicalText = patch.canonicalText ?? current.canonicalText;
    const object = patch.object ?? current.object;
    assertMemorySafe(canonicalText, object);
    return this.create(principal, {
      kind: current.kind,
      subject: current.subject,
      predicate: current.predicate,
      object,
      canonicalText,
      scope: patch.scope ?? current.scope,
      sensitivity: current.sensitivity,
      validFrom: this.now().toISOString(),
      validTo: null,
      expiresAt: patch.expiresAt === undefined ? current.expiresAt : patch.expiresAt,
      explicitness: "explicit",
      confidence: current.confidence,
      sourceIds: [...current.sourceIds, `correction:${id}`],
    });
  }

  public delete(principal: Principal, id: string): { deleted: true; derivativesRemoved: number } {
    const current = this.require(principal, id);
    const now = this.now().toISOString();
    this.#items.set(id, { ...current, status: "deleted", validTo: now, updatedAt: now });
    const derivativesRemoved = this.#derivedKeys.get(id)?.size ?? 0;
    this.#derivedKeys.delete(id);
    return { deleted: true, derivativesRemoved };
  }

  public retrieve(
    principal: Principal,
    query: Omit<MemoryQuery, "tenantId" | "userId">,
  ): MemoryItem[] {
    const ranked = rankMemories(
      { ...query, tenantId: principal.tenantId, userId: principal.userId },
      [...this.#items.values()],
    );
    const now = this.now().toISOString();
    for (const item of ranked)
      this.#items.set(item.id, { ...item, lastUsedAt: now, updatedAt: item.updatedAt });
    return [...ranked];
  }

  private require(principal: Principal, id: string): MemoryItem {
    const item = this.#items.get(id);
    if (item === undefined) throw new MemoryNotFoundError();
    requireTenant(principal, item.tenantId);
    if (item.userId !== principal.userId) throw new MemoryNotFoundError();
    return item;
  }
}
