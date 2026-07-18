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

export function extractInferredMemory(
  text: string,
  sourceId: string,
  userId: string,
  now: Date,
):
  | (Omit<MemoryCandidate, "explicitness" | "confidence"> & {
      explicitness: "inferred";
      confidence: number;
    })
  | undefined {
  assertMemorySafe(text, {});
  const preference = text.match(/\b(?:i prefer|my preference is|i usually use)\s+(.{3,240})/i)?.[1];
  const timezone = text.match(/\bmy time\s?zone is\s+([A-Za-z_+/-]{2,80})/i)?.[1];
  const value = timezone ?? preference?.replace(/[.!?]+$/, "");
  if (value === undefined) return undefined;
  const predicate = timezone === undefined ? "user.preference" : "user.timezone";
  const sensitive = /\b(?:health|medical|bank|financial|legal|identity|diagnosis)\b/i.test(text);
  return {
    kind: "semantic_fact",
    subject: "user.current",
    predicate,
    object: timezone === undefined ? { preference: value } : { timezone: value },
    canonicalText:
      timezone === undefined ? `User preference: ${value}` : `User time zone: ${value}`,
    scope: { type: "user", id: userId },
    explicitness: "inferred",
    confidence: timezone === undefined ? 0.72 : 0.86,
    sensitivity: sensitive ? "highly_sensitive" : "internal",
    validFrom: now.toISOString(),
    validTo: null,
    expiresAt: null,
    sourceIds: [sourceId],
  };
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

export const MEMORY_EMBEDDING_VERSION = "signal-feature-hash-v1";
export const MEMORY_EMBEDDING_DIMENSIONS = 256;

function hashTerm(term: string, seed: number): number {
  let value = seed >>> 0;
  for (let index = 0; index < term.length; index += 1) {
    value ^= term.charCodeAt(index);
    value = Math.imul(value, 16_777_619);
  }
  return value >>> 0;
}

/**
 * Creates a deterministic, non-secret-bearing retrieval vector. The feature
 * hashing keeps local/test operation independent of a model provider while
 * allowing the durable derivative to be replaced by a future provider vector
 * under a new version without changing the memory record.
 */
export function createMemoryEmbedding(text: string): number[] {
  const tokens = [...words(text)];
  const terms = [
    ...tokens,
    ...tokens.slice(0, -1).map((token, index) => `${token}_${tokens[index + 1] ?? ""}`),
  ];
  const vector = Array.from<number>({ length: MEMORY_EMBEDDING_DIMENSIONS }).fill(0);
  for (const term of terms) {
    const bucket = hashTerm(term, 2_166_136_261) % MEMORY_EMBEDDING_DIMENSIONS;
    const sign = (hashTerm(term, 3_332_000_911) & 1) === 0 ? 1 : -1;
    vector[bucket] = (vector[bucket] ?? 0) + sign;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}

export function memoryEmbeddingSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length !== right.length || left.length === 0) return 0;
  return left.reduce((score, value, index) => score + value * (right[index] ?? 0), 0);
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
