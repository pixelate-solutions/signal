# ADR 0004: Meta Model API public-preview adapter

Status: accepted — 2026-07-18

The official Meta launch material identifies Muse Spark 1.1 and the Meta Model API. The public-preview API exposes OpenAI-compatible Responses/Chat surfaces; Signal uses the Responses endpoint at the operator-configured `META_MODEL_API_BASE_URL`, records `META_MODEL_API_VERSION`, and keeps wire handling isolated in `MetaMuseSparkProvider`. The default wire identifier is `muse-spark-1.1`, as returned by Meta's authenticated `/models` endpoint; deployments must run the provider contract probe before promotion.

If Meta changes the preview contract, the provider health check fails closed. Signal does not silently switch models.
