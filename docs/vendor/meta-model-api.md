# Meta Model API integration

Verified: 2026-07-18.

## Selected contract

- Provider: Meta Model API public preview.
- Base URL: operator-configured `META_MODEL_API_BASE_URL`; current public base is `https://api.meta.ai/v1`.
- Primary surface: `POST /responses` with Bearer authentication.
- Compatibility surface: `POST /chat/completions` may be used only by an explicitly configured adapter version.
- Model: `meta/muse-spark-1.1` per the product FRD. The provider records the response model identifier returned by Meta because preview accounts may expose an unqualified wire ID.
- Key: `META_MODEL_API_KEY` in Signal; deployments may source Meta's documented `MODEL_API_KEY` into that secret handle.
- Version metadata: `META_MODEL_API_VERSION=public-preview-2026-07`.

Official launch material: <https://developer.meta.com/ai/resources/blog/build-with-muse-spark/>

## Promotion probe

Before staging or production promotion, call provider `health()` and run contract cases for text, structured JSON, tool calls, streaming, cancellation, usage metadata, image input, and an invalid schema. A mismatch leaves the provider unhealthy and tasks in `WAITING_EXTERNAL`/configuration-required state. No fallback is enabled by default.

## Secret handling

The key exists only in the server environment/secret manager. Request logging records hashes, sizes, model/version, request ID, usage, latency, and sanitized errors—never prompt bodies or authorization headers by default.
