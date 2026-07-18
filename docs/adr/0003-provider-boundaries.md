# ADR 0003: Provider-neutral boundaries and fail-closed credentials

Status: accepted — 2026-07-18

Model, OAuth, push, object storage, browser, sandbox, and external tools use typed provider interfaces. The Meta Model API remains the configured production default. Any missing provider credential produces a stable connection/configuration error and no external-success event.
