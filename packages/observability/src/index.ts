const secretKeys =
  /(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|cookie|private[-_]?key|recovery[-_]?code|card[-_]?number)/i;
const secretValues = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b(?:sk|key|token)_[A-Za-z0-9_-]{16,}\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\b\d{13,19}\b/g,
];

export const REDACTED = "[REDACTED]";

export function redact(value: unknown, key = ""): unknown {
  if (secretKeys.test(key)) {
    return REDACTED;
  }
  if (typeof value === "string") {
    return secretValues.reduce((current, pattern) => current.replace(pattern, REDACTED), value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nested]) => [nestedKey, redact(nested, nestedKey)]),
    );
  }
  return value;
}

export type Correlation = {
  traceId?: string;
  tenantId?: string;
  conversationId?: string;
  taskId?: string;
  stepId?: string;
  toolExecutionId?: string;
  providerRequestId?: string;
  modelRequestId?: string;
  workflowId?: string;
};

export type StructuredLog = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  correlation: Correlation;
  fields: Record<string, unknown>;
};

export function safeLog(log: StructuredLog): StructuredLog {
  return redact(log) as StructuredLog;
}
