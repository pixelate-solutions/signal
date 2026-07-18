import { randomUUID } from "node:crypto";

import type { Principal } from "@signal/auth-sdk";
import { requireTenant } from "@signal/auth-sdk";
import {
  createMemorySchema,
  proposeMemorySchema,
  updateMemorySchema,
  type MemoryItem,
} from "@signal/contracts";
import {
  MEMORY_EMBEDDING_VERSION,
  assertMemorySafe,
  createMemoryEmbedding,
  memoryEmbeddingSimilarity,
  rankMemories,
  type MemoryQuery,
} from "@signal/memory-sdk";
import {
  InMemoryTenantRecordStore,
  type TenantRecordStore,
  type TenantRecordTransaction,
} from "@signal/persistence";

const MEMORY_NAMESPACE = "memory.items";
const DERIVATIVE_NAMESPACE = "memory.derivatives";

type MemoryDerivative = {
  memoryId: string;
  embeddingVersion: string;
  embedding: number[];
  graphKeys: string[];
  createdAt: string;
};

function eligibleMemory(
  item: MemoryItem,
  principal: Principal,
  query: Omit<MemoryQuery, "tenantId" | "userId">,
): boolean {
  const scopeKeys = new Set(query.scopes.map((scope) => `${scope.type}:${scope.id}`));
  return (
    item.tenantId === principal.tenantId &&
    item.userId === principal.userId &&
    item.status === "active" &&
    scopeKeys.has(`${item.scope.type}:${item.scope.id}`) &&
    (item.validTo === null || new Date(item.validTo) > query.now) &&
    (item.expiresAt === null || new Date(item.expiresAt) > query.now)
  );
}

export class MemoryNotFoundError extends Error {
  public constructor() {
    super("Memory item not found.");
    this.name = "MemoryNotFoundError";
  }
}

export class MemoryService {
  public constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly store: TenantRecordStore = new InMemoryTenantRecordStore(),
  ) {}

  public async list(principal: Principal, includeHistory = false): Promise<MemoryItem[]> {
    return this.store.runExclusive(principal.tenantId, async (transaction) =>
      (await transaction.list<MemoryItem>(MEMORY_NAMESPACE))
        .filter(
          (item) =>
            item.userId === principal.userId &&
            (includeHistory || item.status === "active" || item.status === "proposed"),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  public async create(principal: Principal, rawInput: unknown): Promise<MemoryItem> {
    const input = createMemorySchema.parse(rawInput);
    assertMemorySafe(input.canonicalText, input.object);
    return this.store.runExclusive(principal.tenantId, async (transaction) => {
      const now = this.now().toISOString();
      const items = await transaction.list<MemoryItem>(MEMORY_NAMESPACE);
      const replay = items.find(
        (item) =>
          item.userId === principal.userId &&
          input.sourceIds.some((sourceId) => item.sourceIds.includes(sourceId)) &&
          item.canonicalText === input.canonicalText &&
          JSON.stringify(item.object) === JSON.stringify(input.object),
      );
      if (replay !== undefined) return replay;
      for (const current of items) {
        if (
          current.userId === principal.userId &&
          current.scope.type === input.scope.type &&
          current.scope.id === input.scope.id &&
          current.subject === input.subject &&
          current.predicate === input.predicate &&
          current.status === "active"
        ) {
          await transaction.put(MEMORY_NAMESPACE, current.id, {
            ...current,
            status: "superseded",
            validTo: now,
            updatedAt: now,
          } satisfies MemoryItem);
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
      await transaction.put(MEMORY_NAMESPACE, item.id, item);
      await this.putDerivatives(transaction, item);
      return item;
    });
  }

  public async propose(principal: Principal, rawInput: unknown): Promise<MemoryItem> {
    const input = proposeMemorySchema.parse(rawInput);
    assertMemorySafe(input.canonicalText, input.object);
    return this.store.runExclusive(principal.tenantId, async (transaction) => {
      const items = await transaction.list<MemoryItem>(MEMORY_NAMESPACE);
      const replay = items.find(
        (item) =>
          item.userId === principal.userId &&
          input.sourceIds.some((sourceId) => item.sourceIds.includes(sourceId)) &&
          item.canonicalText === input.canonicalText &&
          JSON.stringify(item.object) === JSON.stringify(input.object),
      );
      if (replay !== undefined) return replay;
      const equivalent = items.find(
        (item) =>
          item.userId === principal.userId &&
          item.scope.type === input.scope.type &&
          item.scope.id === input.scope.id &&
          item.subject === input.subject &&
          item.predicate === input.predicate &&
          item.status === "active" &&
          JSON.stringify(item.object) === JSON.stringify(input.object),
      );
      if (equivalent !== undefined) return equivalent;
      const now = this.now().toISOString();
      const item: MemoryItem = {
        id: `mem_${randomUUID().replaceAll("-", "")}`,
        tenantId: principal.tenantId,
        userId: principal.userId,
        ...input,
        status: "proposed",
        pinned: false,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
      };
      await transaction.put(MEMORY_NAMESPACE, item.id, item);
      return item;
    });
  }

  public async update(principal: Principal, id: string, rawInput: unknown): Promise<MemoryItem> {
    const patch = updateMemorySchema.parse(rawInput);
    const current = await this.store.runExclusive(principal.tenantId, (transaction) =>
      this.require(transaction, principal, id),
    );
    const materialChange =
      patch.object !== undefined ||
      patch.canonicalText !== undefined ||
      patch.scope !== undefined ||
      patch.expiresAt !== undefined;
    if (!materialChange) {
      return this.store.runExclusive(principal.tenantId, async (transaction) => {
        const latest = await this.require(transaction, principal, id);
        if (latest.status === "proposed" && patch.status === "active") {
          const now = this.now().toISOString();
          const items = await transaction.list<MemoryItem>(MEMORY_NAMESPACE);
          for (const conflict of items) {
            if (
              conflict.id !== latest.id &&
              conflict.userId === latest.userId &&
              conflict.scope.type === latest.scope.type &&
              conflict.scope.id === latest.scope.id &&
              conflict.subject === latest.subject &&
              conflict.predicate === latest.predicate &&
              conflict.status === "active"
            ) {
              await transaction.put(MEMORY_NAMESPACE, conflict.id, {
                ...conflict,
                status: "superseded",
                validTo: now,
                updatedAt: now,
              } satisfies MemoryItem);
            }
          }
        }
        const updated: MemoryItem = {
          ...latest,
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
          updatedAt: this.now().toISOString(),
        };
        await transaction.put(MEMORY_NAMESPACE, id, updated);
        if (latest.status === "proposed" && updated.status === "active") {
          await this.putDerivatives(transaction, updated);
        }
        return updated;
      });
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

  public async delete(
    principal: Principal,
    id: string,
  ): Promise<{ deleted: true; derivativesRemoved: number }> {
    return this.store.runExclusive(principal.tenantId, async (transaction) => {
      const current = await this.require(transaction, principal, id);
      const now = this.now().toISOString();
      await transaction.put(MEMORY_NAMESPACE, id, {
        ...current,
        status: "deleted",
        validTo: now,
        updatedAt: now,
      } satisfies MemoryItem);
      const derivatives = await transaction.get<MemoryDerivative>(DERIVATIVE_NAMESPACE, id);
      await transaction.remove(DERIVATIVE_NAMESPACE, id);
      return {
        deleted: true,
        derivativesRemoved:
          derivatives === undefined ? 0 : 1 + Math.max(1, derivatives.graphKeys.length),
      };
    });
  }

  public async retrieve(
    principal: Principal,
    query: Omit<MemoryQuery, "tenantId" | "userId">,
  ): Promise<MemoryItem[]> {
    return this.store.runExclusive(principal.tenantId, async (transaction) => {
      const items = await transaction.list<MemoryItem>(MEMORY_NAMESPACE);
      const lexical = rankMemories(
        { ...query, tenantId: principal.tenantId, userId: principal.userId },
        items,
      );
      const queryEmbedding = createMemoryEmbedding(query.text);
      const semantic = (
        await Promise.all(
          items
            .filter((item) => eligibleMemory(item, principal, query))
            .map(async (item) => {
              const derivative = await transaction.get<MemoryDerivative>(
                DERIVATIVE_NAMESPACE,
                item.id,
              );
              return {
                item,
                score:
                  derivative?.embeddingVersion === MEMORY_EMBEDDING_VERSION
                    ? memoryEmbeddingSimilarity(queryEmbedding, derivative.embedding)
                    : 0,
              };
            }),
        )
      )
        .filter(({ score }) => score > 0.05)
        .sort((left, right) => right.score - left.score)
        .map(({ item }) => item);
      const ranked = [...new Map([...lexical, ...semantic].map((item) => [item.id, item])).values()]
        .sort((left, right) => Number(right.pinned) - Number(left.pinned))
        .slice(0, 12);
      const now = this.now().toISOString();
      for (const item of ranked) {
        await transaction.put(MEMORY_NAMESPACE, item.id, {
          ...item,
          lastUsedAt: now,
          updatedAt: item.updatedAt,
        } satisfies MemoryItem);
      }
      return [...ranked];
    });
  }

  private async putDerivatives(
    transaction: TenantRecordTransaction,
    item: MemoryItem,
  ): Promise<void> {
    await transaction.put(DERIVATIVE_NAMESPACE, item.id, {
      memoryId: item.id,
      embeddingVersion: MEMORY_EMBEDDING_VERSION,
      embedding: createMemoryEmbedding(
        `${item.subject} ${item.predicate} ${item.canonicalText} ${JSON.stringify(item.object)}`,
      ),
      graphKeys: [`${item.scope.type}:${item.scope.id}:${item.subject}:${item.predicate}`],
      createdAt: this.now().toISOString(),
    } satisfies MemoryDerivative);
  }

  private async require(
    transaction: TenantRecordTransaction,
    principal: Principal,
    id: string,
  ): Promise<MemoryItem> {
    const item = await transaction.get<MemoryItem>(MEMORY_NAMESPACE, id);
    if (item === undefined) throw new MemoryNotFoundError();
    requireTenant(principal, item.tenantId);
    if (item.userId !== principal.userId) throw new MemoryNotFoundError();
    return item;
  }
}
