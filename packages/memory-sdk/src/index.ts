import type { CreateMemory, MemoryItem } from "@signal/contracts";

const forbiddenSecretPatterns = [
  /\b(?:password|passcode|recovery code|private key|refresh token|access token|session cookie)\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk|token|key)_[A-Za-z0-9_-]{16,}\b/,
  /\b\d{13,19}\b/,
];

const explicitSignals = /\b(?:remember|always|from now on|this is where|i log|we log|i use)\b/i;
const urlPattern = /https?:\/\/[^\s<>()]+/i;

export class ProhibitedMemoryError extends Error {
  public constructor(public readonly reason: string) {
    super(reason);
    this.name = "ProhibitedMemoryError";
  }
}

export function assertMemorySafe(text: string, object: unknown): void {
  const candidate = `${text} ${JSON.stringify(object)}`;
  if (forbiddenSecretPatterns.some((pattern) => pattern.test(candidate))) {
    throw new ProhibitedMemoryError("Secret-like content cannot be stored in memory.");
  }
}

export type MemoryCandidate = Omit<CreateMemory, "validFrom" | "sourceIds"> & {
  sourceIds: string[];
  validFrom: string;
};

export function extractExplicitMemory(
  text: string,
  sourceId: string,
  userId: string,
  now: Date,
): MemoryCandidate | undefined {
  if (!explicitSignals.test(text)) {
    return undefined;
  }
  assertMemorySafe(text, {});

  const url = text.match(urlPattern)?.[0]?.replace(/[.,;!?]+$/, "");
  if (url !== undefined && /\b(?:work calls?|call (?:log|tracker|logging))\b/i.test(text)) {
    return {
      kind: "semantic_fact",
      subject: "user.current",
      predicate: "work_calls.log_url",
      object: { url },
      canonicalText: `Work calls are logged at ${url}`,
      scope: { type: "user", id: userId },
      explicitness: "explicit",
      confidence: 0.99,
      sensitivity: "internal",
      validFrom: now.toISOString(),
      validTo: null,
      expiresAt: null,
      sourceIds: [sourceId],
    };
  }

  return undefined;
}

export type MemoryQuery = {
  text: string;
  tenantId: string;
  userId: string;
  scopes: readonly { type: MemoryItem["scope"]["type"]; id: string }[];
  now: Date;
};

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9_.:/-]+/g) ?? []);
}

export function rankMemories(
  query: MemoryQuery,
  memories: readonly MemoryItem[],
): readonly MemoryItem[] {
  const queryWords = words(query.text);
  const scopeKeys = new Set(query.scopes.map((scope) => `${scope.type}:${scope.id}`));

  return memories
    .filter(
      (memory) =>
        memory.tenantId === query.tenantId &&
        memory.userId === query.userId &&
        memory.status === "active" &&
        scopeKeys.has(`${memory.scope.type}:${memory.scope.id}`) &&
        (memory.validTo === null || new Date(memory.validTo) > query.now) &&
        (memory.expiresAt === null || new Date(memory.expiresAt) > query.now),
    )
    .map((memory) => {
      const memoryWords = words(`${memory.subject} ${memory.predicate} ${memory.canonicalText}`);
      const overlap = [...queryWords].filter((word) => memoryWords.has(word)).length;
      const canonicalBoost =
        /\b(?:call|tracker|log)\b/i.test(query.text) && memory.predicate === "work_calls.log_url"
          ? 10
          : 0;
      return {
        memory,
        score: overlap * 2 + canonicalBoost + memory.confidence + (memory.pinned ? 2 : 0),
      };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map(({ memory }) => memory);
}
