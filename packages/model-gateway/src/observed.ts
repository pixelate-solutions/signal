import type {
  ModelCapabilities,
  ModelHealth,
  ModelMetadata,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  StructuredModelRequest,
} from "./types.js";

export type ModelObservation = {
  request: ModelRequest;
  metadata: ModelMetadata | null;
  durationMs: number;
  error: string | null;
  observedAt: string;
};

export type ModelObservationSink = (observation: ModelObservation) => Promise<void> | void;

export class ObservedModelProvider implements ModelProvider {
  public constructor(
    private readonly delegate: ModelProvider,
    private readonly sink: ModelObservationSink,
  ) {}

  public capabilities(): ModelCapabilities {
    return this.delegate.capabilities();
  }

  public health(): Promise<ModelHealth> {
    return this.delegate.health();
  }

  public async *stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    const started = performance.now();
    let metadata: ModelMetadata | null = null;
    let error: string | null = null;
    try {
      for await (const event of this.delegate.stream(request, signal)) {
        if (event.type === "completed") metadata = event.metadata;
        yield event;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Model stream failed.";
      throw caught;
    } finally {
      await this.sink({
        request,
        metadata,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        error,
        observedAt: new Date().toISOString(),
      });
    }
  }

  public async completeStructured<T>(
    request: StructuredModelRequest<T>,
    signal: AbortSignal,
  ): Promise<ModelResponse<T>> {
    const started = performance.now();
    let response: ModelResponse<T> | undefined;
    let error: string | null = null;
    try {
      response = await this.delegate.completeStructured(request, signal);
      return response;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Structured model request failed.";
      throw caught;
    } finally {
      await this.sink({
        request,
        metadata: response?.metadata ?? null,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        error,
        observedAt: new Date().toISOString(),
      });
    }
  }
}
