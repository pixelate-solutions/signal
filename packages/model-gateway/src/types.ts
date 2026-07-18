import type { z } from "zod";

export type ModelRole = "system" | "developer" | "user" | "assistant" | "tool";

export type ModelContent =
  | { type: "text"; text: string }
  | { type: "image"; artifactHandle: string; mediaType: string }
  | { type: "file"; artifactHandle: string; mediaType: string };

export type ModelMessage = {
  role: ModelRole;
  content: readonly ModelContent[];
  toolCallId?: string;
};

export type ModelTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ModelRequest = {
  requestId: string;
  messages: readonly ModelMessage[];
  tools: readonly ModelTool[];
  maxOutputTokens: number;
  deadline: Date;
  temperature?: number;
  metadata: {
    tenantId: string;
    taskId: string;
    contextVersion: string;
    toolRegistryVersion: string;
    policyVersion: string;
    memorySnapshot: readonly string[];
  };
};

export type StructuredModelRequest<T> = ModelRequest & {
  schemaName: string;
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type ModelMetadata = {
  provider: string;
  model: string;
  apiVersion: string;
  requestId: string;
  usage: ModelUsage;
};

export type ModelResponse<T> = {
  output: T;
  metadata: ModelMetadata;
};

export type ModelStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "usage"; usage: ModelUsage }
  | { type: "completed"; metadata: ModelMetadata };

export type ModelCapabilities = {
  text: boolean;
  images: boolean;
  files: boolean;
  video: boolean;
  tools: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  contextTokens: number;
};

export type ModelHealth = {
  status: "healthy" | "degraded" | "unhealthy";
  reason: string;
  checkedAt: string;
};

export type ModelProvider = {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
  completeStructured<T>(
    request: StructuredModelRequest<T>,
    signal: AbortSignal,
  ): Promise<ModelResponse<T>>;
  capabilities(): ModelCapabilities;
  health(): Promise<ModelHealth>;
};
