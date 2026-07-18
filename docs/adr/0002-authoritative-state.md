# ADR 0002: PostgreSQL and Temporal are authoritative

Status: accepted — 2026-07-18

PostgreSQL stores tenant data, ordered events, snapshots, actions, evidence metadata, and the transactional outbox. Temporal stores deterministic workflow continuation. Redis carries only rebuildable cache, locks, rate limits, and live fan-out. Mobile storage is a cache and can be deleted without losing a task.
