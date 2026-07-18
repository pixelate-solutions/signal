# ADR 0005: Deterministic local runtime alongside Temporal

Status: accepted — 2026-07-18

Fast unit and UI tests need deterministic execution without booting the full infrastructure. The same domain transition functions and activity contracts therefore run through an in-process harness in tests and demo mode. Production mode schedules Temporal workflows. The harness may mutate only its isolated test-provider state and must emit the same evidence and events as the Temporal path.
