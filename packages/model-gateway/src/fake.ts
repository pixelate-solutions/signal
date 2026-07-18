import type {
  ModelCapabilities,
  ModelHealth,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  StructuredModelRequest,
} from "./types.js";

export type DeterministicResponseFactory = (request: StructuredModelRequest<unknown>) => unknown;

export class FakeDeterministicModelProvider implements ModelProvider {
  public constructor(private readonly factory: DeterministicResponseFactory = () => ({})) {}

  public capabilities(): ModelCapabilities {
    return {
      text: true,
      images: true,
      files: true,
      video: false,
      tools: true,
      structuredOutput: true,
      streaming: true,
      contextTokens: 100_000,
    };
  }

  public async health(): Promise<ModelHealth> {
    return {
      status: "healthy",
      reason: "Deterministic test provider ready.",
      checkedAt: new Date(0).toISOString(),
    };
  }

  public async *stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    if (signal.aborted) {
      throw signal.reason;
    }
    const text = request.messages
      .flatMap((message) => message.content)
      .filter((content) => content.type === "text")
      .map((content) => content.text)
      .join(" ")
      .slice(0, 200);
    yield { type: "text_delta", delta: text };
    yield {
      type: "completed",
      metadata: {
        provider: "signal-deterministic",
        model: "fake-deterministic-v1",
        apiVersion: "test-v1",
        requestId: request.requestId,
        usage: { inputTokens: text.length, outputTokens: text.length, reasoningTokens: 0 },
      },
    };
  }

  public async completeStructured<T>(
    request: StructuredModelRequest<T>,
    signal: AbortSignal,
  ): Promise<ModelResponse<T>> {
    if (signal.aborted) {
      throw signal.reason;
    }
    const output = request.schema.parse(this.factory(request as StructuredModelRequest<unknown>));
    return {
      output,
      metadata: {
        provider: "signal-deterministic",
        model: "fake-deterministic-v1",
        apiVersion: "test-v1",
        requestId: request.requestId,
        usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0 },
      },
    };
  }
}
