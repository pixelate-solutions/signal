import { z } from "zod";

import type {
  ModelCapabilities,
  ModelHealth,
  ModelMetadata,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ModelUsage,
  StructuredModelRequest,
} from "./types.js";

type MetaProviderOptions = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  apiVersion: string;
  fetcher?: typeof fetch;
};

const usageSchema = z.looseObject({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  output_tokens_details: z
    .object({ reasoning_tokens: z.number().int().nonnegative().optional() })
    .optional(),
});

function usageFrom(value: unknown): ModelUsage {
  const parsed = usageSchema.safeParse(value);
  if (!parsed.success) {
    return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  }
  return {
    inputTokens: parsed.data.input_tokens ?? parsed.data.inputTokens ?? 0,
    outputTokens: parsed.data.output_tokens ?? parsed.data.outputTokens ?? 0,
    reasoningTokens: parsed.data.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

function requestInput(request: ModelRequest): unknown[] {
  return request.messages.map((message) => ({
    role: message.role,
    content: message.content.map((content) => {
      if (content.type === "text") {
        return { type: "input_text", text: content.text };
      }
      return {
        type: content.type === "image" ? "input_image" : "input_file",
        file_id: content.artifactHandle,
        media_type: content.mediaType,
      };
    }),
    ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
  }));
}

function extractOutputText(payload: Record<string, unknown>): string {
  if (typeof payload["output_text"] === "string") {
    return payload["output_text"];
  }
  const output = Array.isArray(payload["output"]) ? payload["output"] : [];
  const texts: string[] = [];
  for (const item of output) {
    if (item === null || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (
        part !== null &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        texts.push((part as { text: string }).text);
      }
    }
  }
  return texts.join("");
}

function safeProviderErrorField(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = Array.from(String(value), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length === 0 ? null : normalized.slice(0, 500);
}

async function providerResponseError(response: Response, prefix: string): Promise<Error> {
  let detail = "";
  try {
    const payload = (await response.json()) as unknown;
    const candidate =
      payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? ((payload as Record<string, unknown>)["error"] ?? payload)
        : null;
    if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
      const fields = candidate as Record<string, unknown>;
      const values = [
        safeProviderErrorField(fields["type"]),
        safeProviderErrorField(fields["code"]),
        safeProviderErrorField(fields["param"]),
        safeProviderErrorField(fields["message"]),
      ].filter((value): value is string => value !== null);
      if (values.length > 0) detail = `: ${values.join(" — ")}`;
    }
  } catch {
    // Provider bodies can be empty or non-JSON. Status remains the authoritative public detail.
  }
  return new Error(`${prefix} with HTTP ${response.status}${detail}`);
}

export class MetaMuseSparkProvider implements ModelProvider {
  readonly #fetcher: typeof fetch;

  public constructor(private readonly options: MetaProviderOptions) {
    this.#fetcher = options.fetcher ?? fetch;
  }

  public capabilities(): ModelCapabilities {
    return {
      text: true,
      images: true,
      files: true,
      video: true,
      tools: true,
      structuredOutput: true,
      streaming: true,
      contextTokens: 1_048_576,
    };
  }

  public async health(): Promise<ModelHealth> {
    if (this.options.apiKey === undefined || this.options.apiKey.length === 0) {
      return {
        status: "unhealthy",
        reason: "META_MODEL_API_KEY is not configured.",
        checkedAt: new Date().toISOString(),
      };
    }
    try {
      const response = await this.#fetcher(`${this.baseUrl()}/models`, {
        headers: { authorization: `Bearer ${this.options.apiKey}` },
      });
      return {
        status: response.ok ? "healthy" : "degraded",
        reason: response.ok ? "Provider reachable." : `Provider returned HTTP ${response.status}.`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "unhealthy",
        reason: error instanceof Error ? error.message : "Provider health check failed.",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  public async *stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    this.assertConfigured();
    const response = await this.#fetcher(`${this.baseUrl()}/responses`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.body(request, true)),
      signal,
    });
    if (!response.ok) throw await providerResponseError(response, "Meta Model API request failed");
    if (response.body === null) {
      throw new Error(`Meta Model API request failed with HTTP ${response.status}: empty body`);
    }

    const providerRequestId = response.headers.get("x-request-id") ?? request.requestId;
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let usage: ModelUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:") || trimmed === "data: [DONE]") continue;
        const event = JSON.parse(trimmed.slice(5).trim()) as Record<string, unknown>;
        const type = event["type"];
        if (type === "response.output_text.delta" && typeof event["delta"] === "string") {
          yield { type: "text_delta", delta: event["delta"] };
        } else if (type === "response.completed") {
          const responsePayload =
            event["response"] !== null && typeof event["response"] === "object"
              ? (event["response"] as Record<string, unknown>)
              : event;
          usage = usageFrom(responsePayload["usage"]);
          yield { type: "usage", usage };
        }
      }
    }

    yield {
      type: "completed",
      metadata: this.metadata(providerRequestId, usage),
    };
  }

  public async completeStructured<T>(
    request: StructuredModelRequest<T>,
    signal: AbortSignal,
  ): Promise<ModelResponse<T>> {
    this.assertConfigured();
    const response = await this.#fetcher(`${this.baseUrl()}/responses`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        ...this.body(request, false),
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            schema: request.jsonSchema,
            strict: true,
          },
        },
      }),
      signal,
    });
    if (!response.ok) {
      throw await providerResponseError(response, "Meta Model API structured request failed");
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const text = extractOutputText(payload);
    const output = request.schema.parse(JSON.parse(text) as unknown);
    const providerRequestId =
      response.headers.get("x-request-id") ??
      (typeof payload["id"] === "string" ? payload["id"] : request.requestId);
    return {
      output,
      metadata: this.metadata(providerRequestId, usageFrom(payload["usage"])),
    };
  }

  private baseUrl(): string {
    return this.options.baseUrl.replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.options.apiKey ?? ""}`,
      "content-type": "application/json",
      "x-signal-provider-version": this.options.apiVersion,
    };
  }

  private body(request: ModelRequest, stream: boolean): Record<string, unknown> {
    return {
      model: this.options.model,
      input: requestInput(request),
      max_output_tokens: request.maxOutputTokens,
      stream,
      tools: request.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
      metadata: {
        signal_request_id: request.requestId,
        task_id: request.metadata.taskId,
        context_version: request.metadata.contextVersion,
      },
    };
  }

  private assertConfigured(): void {
    if (this.options.apiKey === undefined || this.options.apiKey.length === 0) {
      throw new Error("CONNECTION_REQUIRED: META_MODEL_API_KEY is not configured.");
    }
  }

  private metadata(requestId: string, usage: ModelUsage): ModelMetadata {
    return {
      provider: "meta-model-api",
      model: this.options.model,
      apiVersion: this.options.apiVersion,
      requestId,
      usage,
    };
  }
}
