---
title: "Persistent Operator"
subtitle: "Functional Requirements Document and Production Architecture"
author: "Prepared from product discovery conversation"
date: "18 July 2026"
lang: en-US
---

**Working product name:** Persistent Operator<br>
**Product category:** Intent-to-outcome, persistent cloud agent<br>
**Document version:** 1.0<br>
**Status:** Build-ready baseline<br>
**Primary backend model:** Meta Muse Spark 1.1 (`meta/muse-spark-1.1`)<br>
**Primary mobile surfaces:** Chat and Settings

> **Product promise:** Tell it what needs to become true. It continues working in the cloud, uses connected tools, the web, code, files, and approved device capabilities, asks only for necessary human authority, and returns a verified outcome.

# Contents {.unnumbered}

This navigation summary lists every top-level section. Word’s navigation pane provides the full heading hierarchy.

| Section | Topic | Section | Topic |
| ---: | --- | ---: | --- |
| 1 | Document Control | 19 | Functional Requirements: Policy, Authority, and Approvals |
| 2 | Executive Summary | 20 | Functional Requirements: Verification, Evidence, and Audit |
| 3 | Product Vision: The New Dimension | 21 | System Architecture |
| 4 | Scope | 22 | Data Architecture |
| 5 | Users, Personas, and Jobs to Be Done | 23 | API Requirements |
| 6 | User Experience and Information Architecture | 24 | Security and Privacy |
| 7 | Functional Requirements: Account, Identity, and Sessions | 25 | Reliability, Performance, and Scalability |
| 8 | Functional Requirements: Chat, Tasks, and Durable Execution | 26 | Observability and Operations |
| 9 | Functional Requirements: Notifications and Human Actions | 27 | Testing and Evaluation Strategy |
| 10 | Functional Requirements: OAuth, Connections, and Credentials | 28 | Deployment and DevOps |
| 11 | Functional Requirements: Memory | 29 | Mobile Platform Constraints and Editions |
| 12 | Functional Requirements: Multimodal and File Ingestion | 30 | Release Plan |
| 13 | Functional Requirements: Model and Agent Runtime | 31 | Production Readiness Exit Criteria |
| 14 | Functional Requirements: Capability Registry and Tool System | 32 | Risks and Mitigations |
| 15 | Tool Catalog | 33 | Open Product Decisions |
| 16 | Functional Requirements: Browser Operator | 34 | Codex Build Prompt Usage |
| 17 | Functional Requirements: Safe Self-Extension and Live Code Adaptation | 35 | Implementation References |
| 18 | Functional Requirements: Device Actions | 36 | Glossary |

# Document Control

## Purpose

This Functional Requirements Document (FRD) consolidates the complete product concept into an implementable, production-grade specification. It defines the user experience, functional behavior, durable task model, model and tool architecture, OAuth connection model, memory system, multimodal ingestion, browser operation, self-extending integrations, mobile device controls, security boundaries, data model, APIs, observability, testing, deployment, and phased delivery plan.

The document distinguishes the **target product** from capabilities constrained by mobile operating systems, provider APIs, store policies, or external credentials. It intentionally avoids the unsafe interpretation that one agent process receives permanent root access to every system. The platform supports a broad capability surface; each task receives temporary, policy-scoped access to only the tools and credentials it needs.

## Revision History

| Version | Date | Status | Summary |
| --- | --- | --- | --- |
| 1.0 | 2026-07-18 | Build-ready baseline | Initial complete FRD, including one-time OAuth connections, robust cross-task memory, multimodal ingestion, Meta Muse Spark 1.1, browser fallback, safe self-extension, and device-control constraints. |

## Priority and Release Labels

| Label | Meaning |
| --- | --- |
| P0 | Required for the production V1 baseline or for safety/security correctness. |
| P1 | Required for the complete target product, but may ship immediately after the baseline. |
| P2 | Advanced dimensional capability or scale optimization. |
| V1 | Production baseline with a complete vertical slice. |
| V1.1 | Breadth, memory, and integration expansion. |
| V2 | Safe self-extension and richer device execution. |
| End State | Standing objectives, economic agency, outcome guarantees, and agent-to-agent coordination. |

## Normative Language

“Must” means mandatory. “Should” means strongly recommended unless a documented tradeoff is approved. “May” means optional. “User” means an individual account holder or an authorized member of an organization. “Agent” means the backend orchestration runtime; it does not mean the mobile application. “Tool” means a registered capability with a typed contract, policy metadata, and evidence requirements.

# Executive Summary

Persistent Operator is a chat-first mobile application backed by a durable, continuously available cloud runtime. The mobile application is a secure cockpit, not the execution host. A user can close the app, turn off the phone, lose connectivity, or sign in on another device while work continues on the backend. When the backend needs authority or information that only the user can provide, it creates a structured action request, changes the task to `WAITING_FOR_USER`, sends a push notification, and deep-links the user to the exact interaction card in the task feed.

The interface has only two primary destinations:

1. **Chat**, where the user delegates objectives and watches a structured, truthful execution trace.
2. **Settings**, where the user manages connected accounts, OAuth grants, memory, approval rules, device permissions, privacy, security, and emergency controls.

The execution trace is not hidden chain-of-thought. It exposes operational facts: the current plan, tool selected, arguments redacted for safety, start and completion state, provider errors, retries, route changes, generated code diffs, test results, evidence, and user approvals. It must never expose passwords, OAuth tokens, session cookies, private model reasoning, or sensitive data beyond the user’s display policy.

The system uses three primary routes to act:

- use a native or Composio integration;
- create and test a new API adapter when official documentation exists;
- operate a website through an isolated Playwright browser when no usable API exists.

A fourth route invokes supported actions on the user’s device. This route is deliberately constrained by iOS, Android, provider policy, and store rules. The product must never claim universal silent control of arbitrary phone applications. It uses official APIs, App Intents, Android intents, deep links, compose sheets, HomeKit/Matter, managed-device capabilities, and user takeover. A separate enterprise/private distribution mode may expose deeper, policy-compliant controls where platform rules permit.

The primary model is Meta Muse Spark 1.1. The model is accessed only through a model gateway, never directly by the mobile client or tools. The gateway enforces budgets, tool schemas, context compilation, output validation, redaction, retries, and audit metadata. The provider interface remains replaceable because the Meta Model API is evolving and was in public preview when this document was prepared. [R1][R2]

![Production architecture](/tmp/persistent_operator_frd/diagrams/01_system_architecture.png){width=7.2in}

# Product Vision: The New Dimension

## Dimensional Thesis

Traditional software gives people tools. Copilots help people operate those tools. Task agents complete bounded assignments. Persistent Operator changes the unit of interaction from **application operation** to **delegated responsibility**.

The target progression is:

- App era: `user -> application -> action`
- Agent era: `user objective -> coordinated actions -> verified outcome`
- Dimensional end state: `standing human objective -> continuously maintained reality`

The user should stop asking which app to open and instead state what should happen or remain true. The system becomes the interface to services, websites, files, devices, and eventually other agents.

## Dimensional Characteristics

The product qualifies as a new-dimensional system when it can reliably do all of the following:

- accept outcomes and constraints instead of click-by-click instructions;
- continue for minutes, days, or months independent of the phone;
- maintain standing objectives, not merely execute one-off prompts;
- operate across digital services, websites, code, documents, and supported devices;
- acquire missing capabilities through integration discovery or safe adapter generation;
- act with delegated, revocable authority;
- verify reality rather than report activity;
- recover from routine failures and switch routes;
- remember user facts, procedures, preferences, and prior outcomes across conversations;
- coordinate specialized agents, people, and external systems;
- present evidence and accept accountability for completed work.

## Product Principles

| Principle | Implication |
| --- | --- |
| Outcome over activity | A task is complete only when its success criteria are independently verified. |
| Cloud owns the task | The backend is the source of truth; the app may disappear without stopping work. |
| Simple surface, deep system | Complexity belongs in the backend. The primary UI remains Chat and Settings. |
| Earned autonomy | Authority expands only through explicit policy, demonstrated reliability, and user consent. |
| Capability, not unrestricted power | The platform may support many tools; each execution receives least-privilege access. |
| Truthful trace | Show observable operations and errors, not fabricated progress or private chain-of-thought. |
| API first, browser fallback | Prefer stable, authorized interfaces; use web operation when a usable API is absent. |
| Immutable kernel, mutable skills | The agent may safely extend adapters and workflows, not rewrite identity, policy, secrets, or audit controls. |
| Memory with provenance | Every durable memory must have a source, scope, confidence, sensitivity class, and user control. |
| Human authority at boundaries | MFA, CAPTCHA, signatures, high-risk decisions, and provider restrictions trigger user handoff. |

# Scope

## In Scope

The target system includes:

- iOS and Android mobile applications with Chat and Settings;
- account creation, OIDC authentication, biometric reauthentication, and multi-device sessions;
- persistent conversations and durable task workflows;
- event-streamed execution traces, approvals, errors, retries, evidence, and artifacts;
- APNs and FCM notifications with deep links to required actions;
- one-time OAuth connection flows for Composio and native integrations;
- connection lifecycle management, multiple accounts per provider, scope visibility, disable, refresh, and revoke;
- a credential broker that prevents raw secrets from entering model context;
- Meta Muse Spark 1.1 model gateway and provider abstraction;
- robust working, semantic, episodic, procedural, relationship, policy, and experience memory;
- ingestion of photos, images, PDFs, documents, spreadsheets, presentations, code, archives, audio, and video;
- API and MCP tools, native tools, Composio sessions, browser operation, terminals, filesystems, code editing, document editing, and device commands;
- Playwright browser sessions with autonomous, observed, approval, and takeover modes;
- safe generation, testing, signing, deployment, and rollback of new API adapters;
- typed capability registry, policy engine, risk classification, approval rules, and evidence verification;
- admin, observability, security, billing hooks, audit export, retention, and disaster recovery.

## Explicit Non-Goals for V1

The following are not safe or realistic launch promises:

- arbitrary silent control of every installed iOS application;
- general autonomous Android AccessibilityService control in a normal Google Play distribution;
- bypassing CAPTCHA, MFA, bot protection, provider access controls, or terms of service;
- allowing generated code to modify the production control kernel, policy engine, credential broker, audit system, or deployment authority;
- storing raw passwords, OAuth tokens, payment card numbers, recovery codes, or private keys in model-visible memory;
- marking a task complete merely because an API or webpage returned a success-looking message;
- representing the user in legal, medical, financial, employment, or public communications outside explicit policies and jurisdictional requirements;
- claiming every external service has an API or permits automated use.

## Assumptions

- The production deployment will use managed cloud infrastructure and a durable workflow engine.
- Provider credentials and production OAuth applications will be supplied by the operator of the product.
- The mobile app will be distributed through official stores for the consumer edition and may have separate managed-device or private enterprise editions.
- External service availability, rate limits, terms, and scopes vary by account and region.
- The primary model may evolve. Model-specific behavior must remain behind a stable internal contract.
- All generated integrations begin tenant-scoped and may become reusable only after security review and reliability thresholds are met.

# Users, Personas, and Jobs to Be Done

## Primary Personas

| Persona | Needs | Representative objectives |
| --- | --- | --- |
| Individual operator | Delegate administrative and digital life tasks without learning many apps. | Resolve a bill; schedule a repair; manage travel; update a thermostat; organize notes and files. |
| Founder or small-business owner | Run operations with limited headcount and clear approval rules. | Collect invoices; manage vendors; prepare documents; monitor renewals; coordinate customer follow-up. |
| Operations manager | Create repeatable, auditable, cross-system workflows. | Onboard employees; reconcile records; monitor service levels; escalate exceptions. |
| Power user / developer | Add integrations, inspect tool traces, and use terminals or code sandboxes. | Connect a custom API; generate an adapter; edit a codebase; build and test a workflow. |
| Enterprise administrator | Control organization-wide access, data, policy, and audit. | Approve integrations; set spending policies; manage shared connections; export evidence. |

## Core Jobs to Be Done

- “When I describe an outcome, continue pursuing it until it is verified or a clear human decision is required.”
- “When I close my phone, do not lose progress or stop the task.”
- “When a service needs authentication, let me connect it once and reuse that connection safely.”
- “When I tell you a stable fact about how I work, remember and apply it in future tasks.”
- “When an API does not exist, use the website; when an API does exist, learn how to use it.”
- “When you encounter an error, show the failure, adapt, retest, and avoid repeating irreversible actions.”
- “When you finish, prove the result with receipts, confirmation identifiers, changed state, or another independent check.”

# User Experience and Information Architecture

## Primary Navigation

The mobile application has exactly two persistent primary destinations:

- **Chat**: conversations, tasks, execution traces, approvals, browser takeover, file artifacts, and outcomes.
- **Settings**: connections, memory, permissions, approval rules, device access, notifications, privacy, security, data controls, and support.

Conversation history, active tasks, search, and account switching may appear as sheets or drawers opened from Chat; they are not additional primary tabs.

## Chat Feed Model

A conversation contains user messages and one or more durable tasks. A task has a stable identifier, objective, status, success criteria, plan, event log, artifacts, approvals, and verification record. The visual feed is generated from structured events rather than untrusted prose.

The feed must support these card types:

- user message and assistant response;
- task accepted / objective clarification;
- plan and success criteria;
- tool started, succeeded, failed, timed out, or cancelled;
- browser started, observed, paused, takeover requested, and resumed;
- connection or OAuth required;
- secure credential or sensitive input request;
- approval request with consequences and expiry;
- code changed, tests running, tests passed, tests failed, canary result, rollback;
- retry scheduled, alternate route selected, external wait, deadline warning;
- file uploaded, parsed, quarantined, generated, edited, or ready to download;
- memory proposed, saved, corrected, superseded, or intentionally not saved;
- result verified, completed with warnings, failed, or cancelled.

## Execution Trace Content

The trace may show:

- what step is being performed;
- which registered tool or capability is being used;
- non-secret, user-meaningful inputs;
- provider status codes and sanitized errors;
- retry count and backoff;
- route changes, such as API to browser;
- tests and verification checks;
- evidence links and resulting state;
- the exact decision requiring the user.

The trace must not show:

- private model chain-of-thought;
- raw passwords, access tokens, cookies, API keys, recovery codes, or payment credentials;
- unrestricted terminal output that includes secrets;
- hidden system prompts or internal policy text that would weaken security;
- unredacted personal data beyond the user’s permissions.

## Illustrative Feed

> **Task accepted**<br>
> Change the delivery date for package 4831 to Friday and verify the carrier accepted it.
>
> **Searching capabilities**<br>
> No native carrier integration found. A documented API is available.
>
> **Building integration**<br>
> Created `carrier.get_shipment`, `carrier.change_delivery_date`, and `carrier.get_status`.
>
> **Test failed**<br>
> Sandbox request returned `422: delivery_window is required`.
>
> **Adapting**<br>
> Added the required field and a regression test.
>
> **Retesting**<br>
> 24 tests passed. The new adapter is ready for tenant-scoped use.
>
> **Approval required**<br>
> Allow this integration to read shipment data and change delivery dates?
>
> **Completed**<br>
> Carrier confirmation `CD-18472` shows Friday delivery. A verification check repeated five minutes later returned the same date.

## Settings Structure

| Settings section | Contents |
| --- | --- |
| Account | Profile, sign-in methods, sessions, organization, plan, delete account. |
| Connections | Connected apps, account label, provider, scopes, connection health, last used, reauthenticate, disable, revoke, default account. |
| Memory | Saved facts, preferences, procedures, task history, proposed memories, search, edit, pin, forget, export, sensitivity controls. |
| Permissions | Global tool classes, per-provider permissions, contacts and recipient rules, financial limits, browser domains, code adaptation. |
| Approval rules | Always ask, ask above threshold, allow automatically, deny; by risk, provider, recipient, amount, action, and time. |
| Device access | Contacts, calendar, files, photos, camera, microphone, location, notifications, Home, shortcuts/intents, managed-device status. |
| Notifications | Action-required alerts, reminders, quiet hours, task completion, failure, security events. |
| Security | Biometric lock, passkeys, emergency stop, revoke all, suspicious activity, audit history, trusted devices. |
| Privacy and data | Retention, model data policy, memory capture policy, export, deletion, regional settings. |
| Developer | Custom integrations, API adapters, MCP servers, code sandbox policy, logs, test environments; hidden for non-power users. |

# Functional Requirements: Account, Identity, and Sessions

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| ACC-001 | P0 | V1 | The app must support account creation and sign-in through an OIDC-compatible identity provider, including email-based recovery and optional social identity providers. | A new user can create an account, verify ownership, sign out, sign back in, and recover access without losing tasks. |
| ACC-002 | P0 | V1 | The app must support passkeys where the selected identity provider and platform permit them. | A user can register and use a passkey, and can revoke it from Settings. |
| ACC-003 | P0 | V1 | Sensitive approvals must require recent authentication or biometric confirmation according to risk policy. | A high-risk approval fails when the authentication age exceeds policy and succeeds after biometric or account reauthentication. |
| ACC-004 | P0 | V1 | The backend must support multiple active devices per user and independently revocable refresh sessions. | Settings lists devices and sessions; revoking one prevents further API refresh from that device without affecting others. |
| ACC-005 | P0 | V1 | The mobile app must never store long-lived backend credentials in plaintext. | Static analysis and runtime inspection show tokens only in Keychain/Keystore-backed secure storage. |
| ACC-006 | P0 | V1 | The system must support personal accounts and organization tenants with strict tenant isolation. | Cross-tenant data access tests return deny and generate audit records. |
| ACC-007 | P0 | V1 | Organization roles must include owner, administrator, member, auditor, and service operator. | Role-based tests prove each role can access only its documented features and data. |
| ACC-008 | P0 | V1 | The app must restore the last active conversation and pending action after authentication. | After force quit and relaunch, the exact task card and current backend state appear. |
| ACC-009 | P0 | V1 | Account deletion must use a recoverable grace period followed by verified deletion from primary and derived stores, subject to legal retention. | Deletion workflow exports a receipt, disables access immediately, and completes configured erasure jobs. |

# Functional Requirements: Chat, Tasks, and Durable Execution

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| TASK-001 | P0 | V1 | A user message must be able to create a durable task with objective, constraints, success criteria, budget, deadline, and authority scope. | The task record survives app closure, worker restart, and backend deployment. |
| TASK-002 | P0 | V1 | The backend must be the sole source of truth for task status, events, approvals, artifacts, and continuation state. | Deleting local app data and reinstalling reconstructs the same task state after sign-in. |
| TASK-003 | P0 | V1 | Every task must have a stable task ID and a monotonic event sequence. | Concurrent event generation never produces duplicate sequence numbers within a task. |
| TASK-004 | P0 | V1 | The task workflow must support `CREATED`, `QUEUED`, `PLANNING`, `RUNNING`, `WAITING_EXTERNAL`, `WAITING_USER`, `RETRY_SCHEDULED`, `PAUSED`, `COMPLETED`, `COMPLETED_WITH_WARNINGS`, `FAILED`, and `CANCELLED`. | State-transition tests reject illegal transitions and resume legal waiting states correctly. |
| TASK-005 | P0 | V1 | Long-running tasks must use durable timers and external signals rather than keeping an AI request or process continuously active. | A task waiting seven days consumes no continuous model session and resumes from the recorded continuation. |
| TASK-006 | P0 | V1 | The agent must checkpoint after every side-effecting action and before every user wait. | A forced worker crash after an external write does not repeat the write unless the tool is idempotent or verification proves it did not occur. |
| TASK-007 | P0 | V1 | Every side-effecting tool call must include an idempotency key when the provider supports it. | Repeated delivery of the same workflow activity results in one external action. |
| TASK-008 | P0 | V1 | The app must stream new task events while open and delta-sync missed events after reconnect. | A disconnected device receives all missed events in order without refreshing the whole conversation. |
| TASK-009 | P0 | V1 | The app must show a concise “while you were away” summary generated from authoritative events. | The summary names completed steps, failures, pending actions, and next step without inventing events. |
| TASK-010 | P0 | V1 | The user must be able to pause, resume, cancel, and emergency-stop tasks. | Cancellation prevents future side effects, revokes task leases, and records whether any in-flight action could not be reversed. |
| TASK-011 | P0 | V1 | A task may contain a hierarchy of subtasks and specialized agent jobs while presenting one coherent user-facing operation. | Subtask events roll up to parent progress and retain independent audit records. |
| TASK-012 | P0 | V1 | The agent must explicitly define verification criteria before performing consequential work. | Tasks with write actions contain at least one typed verification check or an approved exception. |
| TASK-013 | P0 | V1 | A task may wait for email, webhook, provider state, timer, price, file, payment, signature, or user action. | Each wait type can wake the correct workflow without polling faster than policy permits. |
| TASK-014 | P0 | V1 | The system must distinguish retryable, user-correctable, policy-blocked, provider-restricted, and terminal failures. | Each class produces the correct state, user message, retry behavior, and alert. |
| TASK-015 | P0 | V1 | The app must offer task search by objective, provider, person, date, status, artifact, and remembered entity. | Search returns both current and completed tasks with tenant-safe filters. |
| TASK-016 | P0 | V1 | The execution trace must be derived from structured events and sanitized logs, not generated as unverified narrative. | Every trace card links to an event payload and cannot claim a tool succeeded without a success record. |
| TASK-017 | P0 | V1 | Users must be able to add instructions or change constraints while a task is active. | A user update is delivered as a durable workflow signal, replans safely, and preserves prior history. |
| TASK-018 | P0 | V1 | When a constraint changes, the agent must revalidate already selected options and pending actions. | A changed budget invalidates an over-budget pending purchase before submission. |
| TASK-019 | P1 | V2 | The system must support standing objectives that spawn or update tasks when monitored conditions change. | A configured objective can react to a webhook or schedule and create an auditable child task. |
| TASK-020 | P2 | End State | The system should support outcome-level service contracts and guarantees with measurable service-level evidence. | A contract definition can calculate success, breach, and remediation from task evidence. |

![Durable task lifecycle](/tmp/persistent_operator_frd/diagrams/02_task_lifecycle.png){width=7.0in}

# Functional Requirements: Notifications and Human Actions

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| NOT-001 | P0 | V1 | When a task enters `WAITING_USER`, the backend must create a typed action request and attempt a push notification. | The action request exists before notification dispatch and remains discoverable if notification delivery fails. |
| NOT-002 | P0 | V1 | Push notifications must state the task, requested action, urgency, expiry, and material consequence without exposing excessive sensitive data. | Notification templates pass privacy review and deep-link tests. |
| NOT-003 | P0 | V1 | Tapping a notification must open the exact conversation and action card. | Deep links work from terminated, backgrounded, and already-open app states. |
| NOT-004 | P0 | V1 | If the phone is off, the task must remain safely paused and the action must appear when the device reconnects. | A simulated offline device receives the pending action after reconnect and no restricted action occurs meanwhile. |
| NOT-005 | P0 | V1 | The user must be able to approve, reject, modify, defer, or ask for more information when the action type supports it. | Each response is persisted as an immutable user decision event and signals the workflow. |
| NOT-006 | P0 | V1 | High-risk actions must open the app and require recent authentication; notification buttons alone must not complete them. | Financial and contractual actions cannot be approved from an unlocked notification surface. |
| NOT-007 | P0 | V1 | Action requests must have expiry and stale-state revalidation. | An expired flight approval cannot submit until price and terms are rechecked. |
| NOT-008 | P0 | V1 | The system must suppress duplicate notifications for the same pending request while allowing policy-based reminders. | Retries do not create duplicate alerts; reminders respect quiet hours and urgency. |
| NOT-009 | P0 | V1 | Users must configure quiet hours, channels, reminders, and categories. | Noncritical alerts are delayed during quiet hours while security-critical alerts follow explicit exceptions. |
| NOT-010 | P0 | V1 | Security notifications must be separate from ordinary task notifications. | New device, suspicious OAuth, emergency stop, and mass-revocation events use dedicated templates and audit records. |
| NOT-011 | P0 | V1 | A pending action must be visible in Chat even when push permission is denied. | The app badge and task list show the pending count without push access. |
| NOT-012 | P1 | V1.1 | Organization tasks may route approvals to a role, group, or named approver. | Only eligible approvers can act, with quorum or sequential approval when configured. |

# Functional Requirements: OAuth, Connections, and Credentials

OAuth is a first-class mobile flow. Users connect tools once, and subsequent tasks reuse the connection until it is revoked, disabled, expires beyond refresh, or requires step-up authorization. Composio connected accounts may store and refresh provider tokens on the product’s behalf, while native integrations use the product credential broker. Composio documents connected accounts as user-scoped authorized connections and supports hosted Connect Links, token storage, refresh, disable, and revoke. [R3][R4][R5]

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| CONN-001 | P0 | V1 | Settings must list all Composio and native connected accounts in one normalized view. | Each entry shows provider, account label, owner, scopes, status, last used, auth method, and connection source. |
| CONN-002 | P0 | V1 | A task requiring an unconnected OAuth tool must pause and present a connection card in Chat. | Completing OAuth returns to the task and automatically retries the blocked capability. |
| CONN-003 | P0 | V1 | Composio OAuth must use Connect Link or the current supported hosted authorization method with a stable internal user ID. | A connected account persists and is reused in later sessions without reauthentication when tokens remain valid. |
| CONN-004 | P0 | V1 | Native OAuth integrations must use Authorization Code with PKCE, state, nonce where applicable, exact redirect URIs, and system browser sessions. | Security tests reject missing or mismatched state, reused codes, and invalid redirect targets. |
| CONN-005 | P0 | V1 | The app must handle OAuth callback deep links and universal/app links from terminated and background states. | All supported states complete the connection and return the user to the originating task or Settings. |
| CONN-006 | P0 | V1 | The credential broker must store native refresh tokens encrypted with envelope encryption and provider-specific metadata. | Database compromise alone does not reveal usable tokens; KMS access is separately controlled. |
| CONN-007 | P0 | V1 | Raw credentials and browser session cookies must never be placed in model context, task events, logs, analytics, or memory. | Automated secret scanners and redaction tests find no known secret fixtures in those surfaces. |
| CONN-008 | P0 | V1 | The system must support multiple accounts for the same provider, including work and personal accounts. | A user can label accounts, choose a default, and pin a specific account to a task. |
| CONN-009 | P0 | V1 | The user must be able to disable, reauthenticate, change default, and revoke a connection from Settings. | Disable blocks tool execution; revoke invalidates the provider grant when supported and deletes local credentials. |
| CONN-010 | P0 | V1 | A task must request only the minimum OAuth scopes required by its capabilities. | Scope diff is shown before consent and policy tests reject broader-than-declared tool use. |
| CONN-011 | P0 | V1 | The connection service must monitor token expiry, refresh failures, revoked grants, and provider health. | Broken connections move to `ACTION_REQUIRED` and affected tasks pause with a targeted notification. |
| CONN-012 | P1 | V1.1 | Organization administrators may create shared service connections with explicit ACLs. | Only permitted roles and tasks can use the shared account; every use names the human or workflow principal. |
| CONN-013 | P1 | V1.1 | OAuth app branding and consent screens should be white-labeled using operator-owned provider credentials in production. | Production Google/GitHub-style consent displays the product identity and approved scopes. |
| CONN-014 | P0 | V1 | Non-OAuth credentials must be collected through a secure form outside model context and sent directly to the credential broker. | The model sees only success/failure and a credential handle, never the entered value. |
| CONN-015 | P0 | V1 | The secure input component must prevent screenshots where supported and must redact values from crash reports. | Platform tests confirm secure text entry and telemetry redaction. |
| CONN-016 | P0 | V1 | Connection usage must be auditable by user, task, capability, provider account, scope, timestamp, and result. | An auditor can answer which connection authorized every external action. |

![One-time OAuth connection flow](/tmp/persistent_operator_frd/diagrams/06_oauth_flow.png){width=7.0in}

# Functional Requirements: Memory

## Memory Model

The memory system is not equivalent to a large model context window. It is a governed data product with explicit types, provenance, temporal validity, conflict resolution, access controls, and user editing.

Required memory classes:

- **Working memory:** current task plan, observations, unresolved questions, and continuation state.
- **Semantic memory:** stable facts and relationships, such as “I log my work calls at `https://example.com/calls`.”
- **Episodic memory:** summaries and evidence from prior conversations and tasks.
- **Procedural memory:** repeatable methods, preferences, templates, and learned workflows.
- **Relationship/entity memory:** people, organizations, accounts, locations, assets, projects, and their links.
- **Policy memory:** explicit authorization rules and prohibitions. Policy memory must never be inferred solely from behavior.
- **Experience memory:** observed tool reliability, provider quirks, prior errors, fixes, and verification strategies.
- **Artifact memory:** files, versions, extracted entities, and task associations.

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| MEM-001 | P0 | V1 | The system must extract candidate memories from explicit user statements, completed tasks, corrections, and artifacts. | The example “I log my work calls at this URL” creates a semantic fact with the URL, source message, user scope, and high confidence. |
| MEM-002 | P0 | V1 | Explicit “remember,” “always,” “this is where,” and “from now on” statements must receive higher confidence and a durable default scope. | Memory extraction tests distinguish explicit declarations from incidental mention. |
| MEM-003 | P0 | V1 | Sensitive or ambiguous inferred memories must require confirmation before becoming durable. | Health, financial, identity, intimate, and credential-adjacent candidates appear as proposed memories or are discarded according to policy. |
| MEM-004 | P0 | V1 | The memory system must store source provenance, author, timestamp, task or message ID, confidence, explicitness, sensitivity, scope, valid-from, valid-to, expiry, and status. | Every active memory record has all mandatory metadata and a retrievable source. |
| MEM-005 | P0 | V1 | The system must support user, organization, project, conversation, and task scopes. | A project-specific procedure is not retrieved in unrelated personal tasks. |
| MEM-006 | P0 | V1 | Memory retrieval must combine exact key lookup, entity graph traversal, full-text search, vector similarity, recency, validity, and task relevance. | Benchmark queries retrieve the work-call URL reliably even when phrased differently. |
| MEM-007 | P0 | V1 | The context compiler must include only the smallest relevant memory set and must cite memory IDs internally. | Model requests contain relevant facts with provenance handles and exclude unrelated sensitive memory. |
| MEM-008 | P0 | V1 | The system must detect contradictory memories and mark them active, superseded, disputed, or pending clarification. | A new stated URL does not silently coexist as equally authoritative with the old URL. |
| MEM-009 | P0 | V1 | User corrections must update future behavior while preserving the historical record. | “That URL changed” supersedes the old value and records the correction source. |
| MEM-010 | P0 | V1 | The agent must be able to say which memory it used and where it came from in user-facing language. | A user can open “Why did you use this?” and see the source conversation or task. |
| MEM-011 | P0 | V1 | Settings must provide memory search, browse by type, edit, pin, confirm, change scope, change expiry, forget, and export. | All operations update retrieval behavior and create audit events. |
| MEM-012 | P0 | V1 | Users must be able to globally disable implicit memory capture while retaining explicit memory commands. | With implicit capture disabled, completed tasks do not write inferred memory. |
| MEM-013 | P0 | V1 | Secrets, OAuth tokens, passwords, session cookies, private keys, payment card data, and MFA recovery codes must never be written to memory. | Secret-pattern fixtures are rejected before storage and generate a sanitized security event. |
| MEM-014 | P0 | V1 | Memory writes must be tenant-isolated, encrypted, and covered by retention and deletion policies. | Cross-tenant retrieval and vector-search tests return no results. |
| MEM-015 | P0 | V1 | Memory retrieval must support temporal queries and avoid using expired facts as current. | A former address is available for historical tasks but not used as the current shipping address. |
| MEM-016 | P0 | V1 | The system must distinguish user preferences from hard constraints and policy. | A preference such as “usually choose nonstop flights” can be traded off; a policy such as “never book basic economy” cannot. |
| MEM-017 | P0 | V1 | The system must learn tool and workflow experience without converting provider errors into user facts. | A carrier’s required parameter is stored as adapter experience, not a user preference. |
| MEM-018 | P0 | V1 | Memory confidence must decay or be revalidated for volatile facts. | Time-sensitive provider URLs, employers, addresses, and contacts receive freshness rules. |
| MEM-019 | P0 | V1 | The system must support compact episodic summaries and retain links to full underlying events and artifacts. | Long task history is retrievable without placing all raw events in model context. |
| MEM-020 | P0 | V1 | Memory retrieval and write decisions must be observable through metrics and offline evaluation. | Dashboards report hit rate, user corrections, false retrievals, stale uses, and sensitive-memory blocks. |
| MEM-021 | P0 | V1 | Users must be able to define canonical aliases and labels for people, projects, accounts, and URLs. | “work call log” and “call tracker” resolve to the same entity and URL. |
| MEM-022 | P1 | V1.1 | The agent should proactively suggest consolidating duplicate procedures or memories. | Duplicate workflow memories produce a nonblocking suggestion, not an automatic destructive merge. |
| MEM-023 | P1 | V1.1 | The memory graph should support organization-wide approved procedures and shared knowledge with role-based visibility. | A shared procedure is retrievable by authorized members and hidden from others. |
| MEM-024 | P2 | V2 | The system should support encrypted user-controlled memory domains whose plaintext is available only during authorized tasks. | A protected memory category requires step-up auth and task-specific unsealing. |

![Memory architecture](/tmp/persistent_operator_frd/diagrams/04_memory_architecture.png){width=7.0in}

## Canonical Memory Example

A user writes: “I log my work calls at `https://calls.example.com/team-log`.”

The write pipeline should create a record similar to:

```json
{
  "kind": "semantic_fact",
  "subject": "user.current",
  "predicate": "work_calls.log_url",
  "object": {"url": "https://calls.example.com/team-log"},
  "scope": "user",
  "explicitness": "explicit",
  "confidence": 0.99,
  "sensitivity": "internal",
  "valid_from": "2026-07-18T00:00:00Z",
  "source": {"type": "message", "id": "msg_..."},
  "status": "active"
}
```

Future requests such as “log that call,” “put this in my call tracker,” or “where do I enter work calls?” should retrieve the same fact. If the user later says “We moved call logging to a new URL,” the old memory becomes `superseded`, remains available for historical explanation, and is excluded from current action planning.

# Functional Requirements: Multimodal and File Ingestion

## Supported Inputs

The app must accept the same broad classes of inputs users expect from a modern multimodal assistant. The model gateway may directly pass supported modalities to Meta Muse Spark 1.1 and must normalize other formats into model-usable text, tables, page images, frames, transcripts, and metadata.

Launch format families:

- images and photos: JPEG, PNG, WebP, HEIC/HEIF, GIF, TIFF, BMP;
- documents: PDF, DOCX, DOC, ODT, RTF, TXT, Markdown, HTML;
- spreadsheets: XLSX, XLS, ODS, CSV, TSV;
- presentations: PPTX, PPT, ODP;
- structured data and code: JSON, JSONL, XML, YAML, SQL, notebooks, common source-code formats;
- archives: ZIP, TAR, GZIP with strict recursion and size limits;
- audio: WAV, MP3, M4A, AAC, FLAC, OGG;
- video: MP4, MOV, WebM, MKV, subject to configured limits;
- application-generated artifacts and browser downloads.

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| ING-001 | P0 | V1 | Chat must support attachment selection from Files, Photos, camera, document scanner, share sheet, and connected cloud storage. | Each source creates an upload card and attaches the canonical artifact to the task. |
| ING-002 | P0 | V1 | Large files must upload directly to object storage using encrypted multipart, resumable uploads. | An interrupted upload resumes without sending the full file through the API server. |
| ING-003 | P0 | V1 | The ingestion service must perform MIME sniffing, extension validation, content hashing, malware scanning, archive-bomb checks, and quarantine. | Malicious and mislabeled fixtures are blocked and never reach the model or sandbox. |
| ING-004 | P0 | V1 | Every artifact must retain original bytes, normalized representations, extraction version, provenance, and checksum. | Reprocessing creates a new derived version without modifying the original. |
| ING-005 | P0 | V1 | PDF ingestion must extract text, document structure, links, metadata, embedded images, and render page images when visual layout matters. | A PDF with charts and tables produces text plus visual page representations and cited page numbers. |
| ING-006 | P0 | V1 | Spreadsheet ingestion must preserve sheet names, values, formulas, merged cells, table ranges, charts, hidden sheets, and data types where safe. | The system can answer formula-aware questions and generate an edited workbook without flattening all formulas. |
| ING-007 | P0 | V1 | Presentation ingestion must extract slide text, speaker notes, tables, media references, and slide images. | A task can summarize and edit a deck while preserving slide order and notes. |
| ING-008 | P0 | V1 | Image ingestion must preserve orientation, color profile where relevant, EXIF policy, and provide model-ready images. | HEIC photos display correctly and privacy policy can strip location metadata. |
| ING-009 | P0 | V1 | Audio and video ingestion must create transcripts, timestamps, speaker labels when feasible, and sampled frames or scene segments. | A task can cite a timestamp and frame from an uploaded recording. |
| ING-010 | P0 | V1 | Code and archive ingestion must use a non-executing parser first and require a sandbox before any build or script execution. | Uploaded code never executes in the API or ingestion process. |
| ING-011 | P0 | V1 | The user must see parse progress, warnings, unsupported elements, and quarantine state in Chat. | A password-protected or corrupted file produces a targeted action request or clear failure. |
| ING-012 | P0 | V1 | Artifacts must be searchable by extracted text, entities, task, source, type, and date. | Search returns an old contract from its clause text and associated task. |
| ING-013 | P0 | V1 | Generated or edited files must appear as versioned artifact cards with preview, open, download, share, and history. | An edited document retains prior versions and displays the generating task and checks. |
| ING-014 | P0 | V1 | The system must support file-level and page/range-level citations in internal verification and user results. | Claims based on a document link to the exact artifact and page, sheet/range, slide, or timestamp. |
| ING-015 | P0 | V1 | The ingestion pipeline must enforce configurable tenant, file, total storage, token, and processing limits. | Quota violations fail before expensive processing and explain available remediation. |
| ING-016 | P0 | V1 | The system must redact or tokenize sensitive fields before sending data to external services when policy requires. | A configured DLP policy removes protected identifiers from model or third-party tool payloads. |
| ING-017 | P0 | V1 | Users must be able to delete an artifact and optionally cascade deletion to derived chunks, embeddings, previews, and memories. | Deletion removes all configured derivatives and preserves only legally required audit metadata. |
| ING-018 | P1 | V2 | The app should support live camera or screen-share context as an optional task input where platform policy permits. | Media is streamed only with foreground consent and stops visibly when permission ends. |

![Multimodal ingestion pipeline](/tmp/persistent_operator_frd/diagrams/07_ingestion_pipeline.png){width=7.0in}

# Functional Requirements: Model and Agent Runtime

## Model Choice and Abstraction

Meta Muse Spark 1.1 is the required default backend model. Meta’s current developer material identifies it on the Meta Model API and describes million-token context and multimodal, agentic use. The implementation must use the official current model identifier and API semantics rather than copying an outdated sample. [R1][R2]

The internal model contract must remain provider-neutral. This is not an invitation to silently switch models; it is a reliability and migration boundary. The configured default is `meta/muse-spark-1.1`. Any fallback must be explicitly configured, logged, and disclosed in task metadata.

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| AI-001 | P0 | V1 | The model gateway must expose a provider-neutral interface for streaming text, structured output, tool calls, multimodal inputs, usage, and cancellation. | A mock provider and the Meta provider pass the same contract tests. |
| AI-002 | P0 | V1 | The default production model configuration must be Meta Muse Spark 1.1. | Task metadata records the exact model ID, provider API version, and request ID. |
| AI-003 | P0 | V1 | The model API key and provider credentials must remain server-side in the credential system. | No mobile bundle, client log, or public endpoint contains the provider secret. |
| AI-004 | P0 | V1 | The agent runtime must use a closed loop of perceive, retrieve, plan, authorize, act, observe, verify, and replan. | A simulated tool failure causes a bounded replan and alternative route rather than a fabricated success. |
| AI-005 | P0 | V1 | The model must never receive direct unrestricted network, filesystem, terminal, or credential access. | All actions pass through typed tool contracts and policy authorization. |
| AI-006 | P0 | V1 | Tool arguments must be schema-validated before policy evaluation and execution. | Malformed, extra, or disallowed fields are rejected before reaching a provider. |
| AI-007 | P0 | V1 | Model output that controls a consequential action must be validated against deterministic rules and current task state. | An outdated or hallucinated account ID cannot execute. |
| AI-008 | P0 | V1 | The context compiler must combine current task state, relevant memory, artifacts, policies, tool summaries, and recent events within configured budgets. | Context assembly is deterministic, inspectable, and excludes unrelated data. |
| AI-009 | P0 | V1 | Long tasks must use context compaction and structured state rather than relying on the full raw conversation. | A multi-day task can resume after model context is discarded. |
| AI-010 | P0 | V1 | The agent must support parallel read-only subtasks and serialized or locked side-effecting actions. | Parallel research improves latency without racing duplicate writes. |
| AI-011 | P0 | V1 | The system must enforce per-task and per-tenant model token, wall-clock, tool-call, and spend budgets. | Budget exhaustion pauses or fails the task with a clear report. |
| AI-012 | P0 | V1 | The agent must have a maximum retry and adaptation budget to prevent unbounded loops. | Repeated identical failures trigger escalation rather than infinite retry. |
| AI-013 | P0 | V1 | The runtime must separate user-facing progress summaries from private model reasoning. | Events expose actions and rationale summaries without storing chain-of-thought. |
| AI-014 | P0 | V1 | Every model call must be traceable to task, step, context version, tool registry version, policy version, and memory snapshot. | An incident investigator can reproduce the non-secret inputs and decisions. |
| AI-015 | P1 | V1.1 | The platform should support model evaluation and controlled model-version rollout by tenant or task class. | A canary model version can be compared and rolled back without changing mobile clients. |

# Functional Requirements: Capability Registry and Tool System

## Core Tool Contract

Every tool must have a manifest with:

- stable name and semantic version;
- owner, source, and execution provider;
- description and supported outcomes;
- typed input and output schemas;
- authentication method and required scopes;
- risk class and default approval policy;
- reversibility and idempotency characteristics;
- timeouts, retries, rate limits, and cost hints;
- allowed network destinations and data classes;
- verification method and evidence schema;
- observability and redaction rules;
- health and deprecation state.

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| TOOL-001 | P0 | V1 | The platform must maintain a tenant-aware capability registry for native, Composio, generated, browser, sandbox, document, and device tools. | The agent can discover tools by desired action while respecting tenant availability and policy. |
| TOOL-002 | P0 | V1 | Tool discovery must not load the entire global tool catalog into model context. | Search or meta-tools return a small relevant set with stable IDs. |
| TOOL-003 | P0 | V1 | Each tool execution must receive a scoped execution context containing task, user, tenant, approved connection, policy decision, budget, and idempotency key. | Tools cannot substitute another user or connection. |
| TOOL-004 | P0 | V1 | The tool gateway must enforce input validation, policy, rate limits, timeouts, circuit breakers, retries, and output limits. | Provider faults cannot bypass policy or overload the model context. |
| TOOL-005 | P0 | V1 | Large tool outputs must be stored as artifacts and summarized rather than inserted in full into model context. | A 100,000-row export is processed in a workspace and referenced by handle. |
| TOOL-006 | P0 | V1 | Tools must return a normalized result with status, data handle, sanitized message, provider metadata, evidence, retryability, and side-effect state. | All tool adapters pass common contract tests. |
| TOOL-007 | P0 | V1 | Side-effecting tools must declare verification and compensation behavior. | A purchase tool names receipt verification and cancellation/refund capabilities. |
| TOOL-008 | P0 | V1 | The router must prefer native integrations, then Composio, then generated API adapters, then browser operation, then supported device actions, then human takeover. | Routing tests select the highest reliability route that satisfies policy and cost. |
| TOOL-009 | P0 | V1 | The router must re-evaluate route choice after failure, scope mismatch, rate limit, or provider restriction. | An API outage can fall back to browser only when policy permits and duplicate action checks pass. |
| TOOL-010 | P0 | V1 | The user or administrator must be able to disable a tool, provider, domain, or capability class. | Disabled capabilities disappear from discovery and active tasks pause safely. |
| TOOL-011 | P0 | V1 | The system must support MCP-compatible tools through a hardened gateway. | MCP servers run with allowlisted capabilities, origin validation, and no direct credential exposure. |
| TOOL-012 | P0 | V1 | Tool versions must be pinned per active task to avoid behavior changes mid-step. | A deployment does not change an in-flight adapter without an explicit workflow migration. |
| TOOL-013 | P0 | V1 | The registry must track reliability, latency, cost, failure classes, and verification success by version. | The router can avoid a degraded adapter and operators can review quality. |
| TOOL-014 | P0 | V1 | A capability may be shared across users only after review and explicit publication; otherwise it remains tenant-scoped. | Generated code cannot automatically become global. |
| TOOL-015 | P2 | End State | The system should support a signed capability marketplace with publisher identity, permissions, tests, and reputation. | A user can inspect and install a verified skill without granting undeclared scopes. |

## Capability Routing

![Capability routing ladder](/tmp/persistent_operator_frd/diagrams/03_capability_routing.png){width=6.8in}

# Tool Catalog

The catalog below defines the tool classes the production platform must support. “Native priority” means a first-party adapter is preferred for reliability and control. “Dynamic” means the exact provider set is discovered from Composio, MCP, or generated adapters. Provider APIs and terms determine whether a specific action is available.

| Category | Required capabilities | Execution route | Typical auth / risk |
| --- | --- | --- | --- |
| Web and research | Search, fetch URL, inspect pages, download, screenshot, structured extraction, citation capture. | Search service + browser worker. | No auth or browser session; read risk. |
| Browser control | Navigate, DOM/accessibility snapshot, click, type, select, upload/download, tabs, dialogs, screenshots, network observation, takeover. | Playwright isolated browser. | Credential broker or user takeover; variable risk. |
| HTTP and APIs | REST, GraphQL, webhook, OpenAPI, pagination, rate limiting, retries, signatures. | Native/generated adapter or generic HTTP tool. | OAuth, API key, bearer, mTLS; declared scopes. |
| MCP | Discover and execute MCP server tools. | Hardened MCP gateway. | Per-server token or local connection; high trust review. |
| Terminal and CLI | Shell, language runtimes, package managers, compilers, linters, tests, approved network calls. | Disposable sandbox. | No user secret by default; scoped handles. |
| Filesystem | Read, write, move, diff, archive, search, checksum, version, upload, download. | Task workspace and artifact service. | Task scoped; reversible writes. |
| Source control | Clone, branch, diff, commit, test, open pull request, review. | Native GitHub/GitLab/Bitbucket plus sandbox Git. | OAuth; repository scopes; external write. |
| Code editing | Inspect codebase, edit, refactor, generate tests, run tests, package adapter. | Coding agent in sandbox. | Repository and egress policy. |
| Documents | Create/edit DOCX, ODT, RTF, text, templates, comments, tracked changes, rendering and QA. | Document worker + LibreOffice/tooling. | Artifact access; internal write. |
| PDFs | Read, render, extract, split/merge, fill, annotate, redact, sign workflow, generate. | PDF worker. | Artifact access; signing requires approval. |
| Spreadsheets | Read/write XLSX/CSV/ODS, formulas, tables, validation, charts, imports/exports. | Spreadsheet worker. | Artifact access; data sensitivity. |
| Presentations | Read/write PPTX/ODP, notes, images, charts, render. | Presentation worker. | Artifact access. |
| Images | Inspect, transform, crop, resize, redact, annotate, metadata handling. | Image worker and model vision. | Artifact access. |
| Audio/video | Transcribe, segment, timestamp, summarize, extract frames, create derivatives. | Media worker + model. | Consent and content policy. |
| Email | Search, read, draft, send, label, archive, attachments, thread monitoring. | Native Gmail/Microsoft Graph, Composio. | OAuth; send is external communication. |
| Calendar | Search, availability, create/update/delete, respond, reminders. | Native Google/Microsoft, Composio. | OAuth; write may require approval. |
| Contacts | Find, read, create/update where allowed. | Native Google/Microsoft/device. | OAuth/device permission; PII. |
| Cloud storage | Drive, OneDrive, Dropbox, Box: search, read, write, share, permissions. | Native/Composio. | OAuth; sharing can be high risk. |
| Productivity | Docs, Sheets, Slides, Notion, Airtable, Coda. | Native/Composio/generated. | OAuth; write risk. |
| Team communication | Slack, Teams, Discord, approved messaging providers. | Native/Composio/API/browser. | OAuth; external communication. |
| Project management | Jira, Linear, Asana, Trello, Monday: issues, projects, comments, status. | Native/Composio. | OAuth; organizational write. |
| CRM | Salesforce, HubSpot and equivalents: search, update, activities, pipeline. | Native/Composio/generated. | OAuth; customer data. |
| Accounting | QuickBooks, Xero, NetSuite and equivalents: invoices, reconciliation, reports. | Native/Composio/generated. | OAuth; financial high risk. |
| Payments and commerce | Stripe and approved processors: payment links, refunds, subscriptions, receipts. | Native API; browser only under strict policy. | Strong scopes; financial approval. |
| SMS and voice | Compose/send where provider permits, call or message through Twilio-like services, receive webhooks. | Provider API; device compose UI. | OAuth/API key; external communication. |
| Social platforms | Read permitted content, draft/publish, DM where official policy allows. | Official APIs first; browser fallback only if permitted. | OAuth; reputation and external communication. |
| Smart home | Matter/HomeKit/Google Home/Nest/ecobee/Hue-style read and control. | Native provider APIs or on-device frameworks. | OAuth/device grants; physical action. |
| Device commands | Open deep link, App Intent/Shortcut, Android intent, create local record, compose message, pick file, authenticate, return evidence. | Signed command to on-device executor. | Per-capability permission and recent auth. |
| Databases | Read/query approved SQL or data warehouses; controlled writes. | Native connector or sandbox client. | Short-lived DB credentials; high data risk. |
| Infrastructure | Cloud status, logs, deploy to approved environments, feature flags, incident tools. | Native APIs and sandbox CLI. | Privileged; organization-only approvals. |
| Notifications and monitoring | Webhooks, email triggers, prices, shipment status, task wake events. | Temporal signals, event adapters, polling policy. | Provider auth; read/trigger risk. |
| Human services | Request quote, schedule provider, route to human operator, browser takeover. | Communication tools + action request. | Consent, identity, payment policy. |

# Functional Requirements: Browser Operator

The browser is a universal but lower-reliability adapter. Playwright supports structured accessibility snapshots for agent interaction, while stored browser authentication state is sensitive and must be treated as a credential. [R6][R7]

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| BROW-001 | P0 | V1 | Browser sessions must run in isolated containers or microVMs scoped to a user, task, and provider domain. | A session cannot access another user’s cookies, files, local storage, or downloads. |
| BROW-002 | P0 | V1 | The browser agent must prefer DOM and accessibility-tree interaction and use screenshots/vision when structure is insufficient. | Common pages can be operated without coordinate-only scripts and fall back safely. |
| BROW-003 | P0 | V1 | The browser must support autonomous, observed, approval, and user-takeover modes. | The user can watch and take control without losing the backend task or browser state. |
| BROW-004 | P0 | V1 | Credentials must be injected by the credential broker or entered by the user in a secure takeover surface; the model must not receive the secret. | Browser login succeeds while trace and model logs contain only credential handles and status. |
| BROW-005 | P0 | V1 | Authenticated browser state must be encrypted, access-controlled, short-lived, revocable, and excluded from source control and ordinary logs. | Session-state files are envelope-encrypted and inaccessible outside the browser worker identity. |
| BROW-006 | P0 | V1 | The browser must pause for MFA, CAPTCHA, unusual security questions, signatures, and provider-required human consent. | No CAPTCHA-bypass tool exists and takeover resumes at the correct workflow continuation. |
| BROW-007 | P0 | V1 | Before an irreversible or material action, the browser must capture the material terms and request approval according to policy. | A submit/purchase/cancel action cannot click the final control until the current terms are authorized. |
| BROW-008 | P0 | V1 | The browser must detect whether a side effect may already have occurred after timeout or navigation failure. | It checks provider state or confirmation identifiers before retrying. |
| BROW-009 | P0 | V1 | Browser downloads and uploads must flow through the artifact service with scanning and provenance. | Downloaded files are quarantined until scanned and linked to the task. |
| BROW-010 | P0 | V1 | Browser content must be treated as untrusted data and must not override system policy or tool authority. | Indirect prompt-injection fixtures cannot cause unrelated tool calls or data exfiltration. |
| BROW-011 | P0 | V1 | Network egress must be restricted by task and domain policy, including redirect and subresource handling. | A malicious page cannot navigate the worker to an unapproved exfiltration endpoint. |
| BROW-012 | P0 | V1 | The browser must capture evidence appropriate to the action: URL, timestamp, provider account, screenshot, DOM snapshot, confirmation ID, and post-action state. | Completed browser tasks contain sufficient evidence for replay and dispute. |
| BROW-013 | P0 | V1 | Selectors and learned browser skills must be versioned and monitored for page changes. | A layout regression fails visibly and triggers repair rather than clicking an uncertain target. |
| BROW-014 | P0 | V1 | The user must be able to terminate a browser session immediately. | Stop closes the session, revokes leases, and prevents queued browser actions. |
| BROW-015 | P0 | V1 | The system must honor robots, provider restrictions, account agreements, and product policy before browser automation. | Restricted domains or actions fail with a policy explanation. |
| BROW-016 | P1 | V1.1 | Browser sessions should support remote takeover streaming with low enough latency for MFA and consent. | On supported networks, interaction latency meets the defined takeover SLO. |
| BROW-017 | P1 | V2 | The system should learn reusable browser skills from successful traces only after review and regression tests. | A reviewed skill can be replayed on fixtures and rolled back. |

# Functional Requirements: Safe Self-Extension and Live Code Adaptation

## Boundary

The agent may edit and test code to add or repair capabilities. It may not directly rewrite the production control kernel while holding live credentials or executing the user’s task. The protected kernel includes identity, policy, credential storage, audit, billing, deployment authority, and tenant isolation. Mutable components include adapters, tool manifests, browser skills, workflow templates, data transformations, and their tests.

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| EXT-001 | P0 | V1 | When a capability is missing, the router must create a typed capability gap describing the minimal action, inputs, output, authentication, risk, and verification. | The coding agent receives a narrow contract rather than a vague request to integrate an entire provider. |
| EXT-002 | P0 | V1 | Documentation discovery must prefer official provider-controlled documentation, machine-readable OpenAPI, GraphQL introspection where allowed, official SDKs, and sandbox environments. | Every generated adapter records documentation URLs, hashes, versions, and retrieval time. |
| EXT-003 | P0 | V1 | The adapter builder must generate typed schemas, authentication handling, request logic, error normalization, retries, rate limits, redaction, and evidence extraction. | The generated package passes the tool SDK contract and contains no hard-coded secrets. |
| EXT-004 | P0 | V1 | Generated code must execute only in a disposable sandbox with restricted network, filesystem, compute, time, and cost. | The sandbox cannot access production control-plane credentials or host sockets. |
| EXT-005 | P0 | V1 | The builder must run formatting, linting, type checking, unit tests, schema tests, mocked contract tests, auth tests, sandbox integration tests, failure tests, idempotency tests, and secret scans. | A write-capable adapter cannot advance if any mandatory test fails. |
| EXT-006 | P0 | V1 | The agent must iterate on failures, show sanitized errors in Chat, and add regression tests for discovered provider requirements. | A missing parameter failure results in a code change, new test, and passing rerun. |
| EXT-007 | P0 | V1 | Generated packages must produce an SBOM, dependency vulnerability report, license report, and signed build artifact. | Unsigned or policy-failing artifacts cannot enter the capability registry. |
| EXT-008 | P0 | V1 | Read-only low-risk adapters may use automated activation when policy permits; write-capable or sensitive adapters require approval and canary. | Risk classification controls the activation path. |
| EXT-009 | P0 | V1 | Deployment must be versioned, tenant-scoped, reversible, and separate from code generation. | The agent cannot overwrite a running package in place. |
| EXT-010 | P0 | V1 | Canary execution must use limited accounts, limits, and monitored verification before broader use. | A failure triggers automatic rollback and preserves the previous version. |
| EXT-011 | P0 | V1 | The original task must resume automatically after a capability is activated. | The workflow continuation references the new version and does not restart completed steps. |
| EXT-012 | P0 | V1 | The agent may repair an existing adapter after provider changes using the same controlled pipeline. | A changed API schema creates a new version and regression suite. |
| EXT-013 | P0 | V1 | Generated adapters must declare exact egress destinations and may not call arbitrary domains. | Runtime network policy blocks undeclared destinations. |
| EXT-014 | P0 | V1 | The coding agent must not modify policy, credential, audit, tenant-isolation, billing, or deployment-approval code. | Repository path and runtime controls prevent protected-kernel writes. |
| EXT-015 | P0 | V1 | A webpage, email, document, or API response must not be able to instruct the browser agent to launch code modification. | Cross-agent trust boundaries reject untrusted content as development authority. |
| EXT-016 | P0 | V1 | The user must be able to inspect the adapter summary, requested scopes, code diff, tests, and risk before approval. | The approval card exposes human-readable and technical views. |
| EXT-017 | P0 | V1 | The registry must retain version history, provenance, test reports, approval identity, rollout state, and rollback reason. | An incident can identify exactly which generated code executed. |
| EXT-018 | P1 | V2 | The platform should support publishing reviewed adapters to an organization or global skill catalog. | Publication uses a separate review and signing identity. |
| EXT-019 | P1 | V2 | The platform should use provider documentation change detection to proactively retest affected adapters. | A documentation or schema change queues a nonproduction regression run. |
| EXT-020 | P2 | V2 | The system should support workflow generation from OpenAPI plus Arazzo-style multi-call descriptions where available. | A generated workflow can execute a documented sequence with dependencies. |

![Safe self-extension pipeline](/tmp/persistent_operator_frd/diagrams/05_self_extension.png){width=7.0in}

# Functional Requirements: Device Actions

## Architecture

The cloud remains authoritative and sends a signed, narrowly typed command to the on-device executor. The mobile application validates the signature, user, device, task, expiry, required permission, foreground/background eligibility, and local approval requirement before invoking platform APIs. It returns a typed result and evidence to the backend.

The cloud cannot make an offline phone perform an action. It may queue the command, notify the user when the device returns, or use a direct provider API instead. The product must prefer provider APIs over visual control of a phone application.

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| DEV-001 | P0 | V1 | Device commands must be declarative, signed, short-lived, replay-protected, and scoped to a task and device. | A captured command cannot be modified, replayed, or executed on another device. |
| DEV-002 | P0 | V1 | The on-device executor must expose only reviewed capability types shipped with the app. | The backend cannot download and execute arbitrary native code. |
| DEV-003 | P0 | V1 | Supported common capabilities must include deep links, app links, App Intents/Shortcuts, Android intents, file picker/share, contacts lookup, calendar access, photos/camera, location, Home controls, secure authentication, and compose interfaces where permitted. | Each capability has platform-specific tests and permission disclosure. |
| DEV-004 | P0 | V1 | The system must prefer direct service APIs or smart-home frameworks over UI automation inside another app. | A thermostat task uses the provider/Home interface when available. |
| DEV-005 | P0 | V1 | iOS device actions must use documented frameworks and must not promise arbitrary silent control of other apps. | The App Store build contains no private API or dynamic native-code loader. |
| DEV-006 | P0 | V1 | SMS and similar communications must use provider APIs or platform compose flows according to platform rules and user policy. | On platforms requiring confirmation, the user sees and confirms the message. |
| DEV-007 | P0 | V1 | The Google Play consumer edition must not use AccessibilityService for general autonomous planning and execution. | Play build policy review confirms no prohibited autonomous Accessibility behavior. |
| DEV-008 | P0 | V1 | Android background work must use platform-appropriate scheduling and foreground notification rules. | Persistent local operations survive restart only within WorkManager/foreground-service constraints. |
| DEV-009 | P0 | V1 | The app must report unsupported, permission-denied, offline, expired, and user-cancelled device actions truthfully. | The backend never marks a local action complete without a result or external verification. |
| DEV-010 | P0 | V1 | Users must manage device permissions and standing action rules in Settings. | Revoking a local permission immediately blocks future commands and updates backend capability health. |
| DEV-011 | P1 | V2 | A managed enterprise edition may expose additional MDM/device-owner capabilities with separate packaging, policy, and disclosure. | Enterprise-only tools cannot be invoked by consumer tenants. |
| DEV-012 | P1 | V2 | The system should support user-authored deterministic automations that are distinct from model-planned arbitrary UI control. | A static trigger-action rule can execute only its declared sequence. |

Apple’s Background Tasks framework allows limited background work rather than an always-running arbitrary agent, so persistent intelligence stays in the cloud. Android WorkManager persists scheduled work across restarts and reboots, but Google Play explicitly prohibits using AccessibilityService to let a general assistant autonomously plan and execute arbitrary actions. [R8][R9][R10]

# Functional Requirements: Policy, Authority, and Approvals

## Risk Classes

| Class | Examples | Default |
| --- | --- | --- |
| R0 - Read only | Search, read document, check status, calculate. | May execute when data-access policy permits. |
| R1 - Reversible internal write | Create draft, note, reminder, internal file, thermostat adjustment. | May execute under standing permission; record evidence. |
| R2 - External communication | Send email, text, DM, publish, contact provider. | Ask by default unless recipient/action rule explicitly allows. |
| R3 - Financial, contractual, sensitive | Purchase, refund, transfer, sign, share protected data, cancel binding service. | Recent authentication and explicit approval by default. |
| R4 - Privileged or irreversible | Production deployment, legal filing, destructive delete, account ownership change. | Multi-party or elevated approval; may be prohibited. |

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| POL-001 | P0 | V1 | Every tool action must receive a deterministic policy decision before execution. | No capability path can bypass the policy service. |
| POL-002 | P0 | V1 | Policies must support user, organization, task, provider, connection, domain, recipient, data class, amount, time, location, and action conditions. | A rule can allow scheduling messages to family but deny attachments or financial content. |
| POL-003 | P0 | V1 | Approval cards must state the exact proposed action, material terms, data shared, connection used, consequences, reversibility, and expiry. | A user can make an informed decision without opening technical logs. |
| POL-004 | P0 | V1 | Standing permissions must be explicit, editable, revocable, and never inferred from repeated approvals alone. | Repeated behavior may produce a suggestion but cannot silently create authority. |
| POL-005 | P0 | V1 | The policy system must support hard deny, require approval, allow with limits, allow, and require multi-party approval. | Each decision produces a policy reason and version. |
| POL-006 | P0 | V1 | Financial policies must support per-transaction, daily, provider, merchant, category, and cumulative limits. | A sequence of small purchases cannot evade a daily limit. |
| POL-007 | P0 | V1 | Communication policies must support recipient groups, channels, content sensitivity, attachments, and quiet hours. | A permitted scheduling text cannot include a medical file. |
| POL-008 | P0 | V1 | Data policies must control which data classes may be sent to each provider, model, tool, or domain. | Protected data is blocked or redacted before egress. |
| POL-009 | P0 | V1 | The system must reauthorize if action details materially change after approval. | A price, date, recipient, contract term, or scope change invalidates the prior approval. |
| POL-010 | P0 | V1 | The system must support emergency stop at user, organization, connection, tool, domain, and platform level. | Stop revokes active leases and blocks new actions within the defined SLO. |
| POL-011 | P0 | V1 | Approvals must be bound to a cryptographic action digest so they cannot authorize a modified payload. | Changing any material field causes digest mismatch and denial. |
| POL-012 | P0 | V1 | The policy engine must distinguish provider permission from product permission; both are required. | A broad OAuth token cannot override a user deny rule. |
| POL-013 | P0 | V1 | The agent must surface when a requested objective cannot be completed within policy rather than attempting circumvention. | The trace names the blocked action and available safe alternatives. |
| POL-014 | P0 | V1 | Organization policies must override user policies only according to documented precedence. | Policy evaluation returns the winning rule and full non-secret explanation. |
| POL-015 | P0 | V1 | Policy and approval changes must be fully audited and versioned. | Past actions can be evaluated against the policy version active at execution. |
| POL-016 | P1 | V2 | The system should support jurisdiction- and domain-specific policy packs for regulated workflows. | A policy pack can enforce mandatory human review and retention. |

# Functional Requirements: Verification, Evidence, and Audit

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| AUD-001 | P0 | V1 | Every task must define one or more success checks, or document why verification requires human acceptance. | A write task cannot enter `COMPLETED` without all mandatory checks. |
| AUD-002 | P0 | V1 | Verification should use an independent read or external signal when possible rather than trusting the write response. | After changing a delivery date, the system reads the shipment status again. |
| AUD-003 | P0 | V1 | Evidence must be immutable, content-addressed, time-stamped, and linked to task, step, tool version, connection, and verifier. | Evidence tampering changes the hash and is detected. |
| AUD-004 | P0 | V1 | The audit log must record identity, delegated principal, policy decision, tool input digest, result, provider request ID, and user approvals. | Every external side effect is reconstructable without exposing secrets. |
| AUD-005 | P0 | V1 | The user must be able to view a human-readable completion receipt. | The receipt lists objective, outcome, material actions, evidence, costs, warnings, and unresolved items. |
| AUD-006 | P0 | V1 | Audit data must be exportable for the user and organization in machine-readable form. | Export contains ordered events, approvals, artifacts, and evidence references. |
| AUD-007 | P0 | V1 | The system must distinguish activity success from outcome success. | An email sent is not equivalent to an appointment booked unless confirmation arrives. |
| AUD-008 | P0 | V1 | A task with partial completion must use `COMPLETED_WITH_WARNINGS` and identify unmet criteria. | No partial task is presented as fully successful. |
| AUD-009 | P0 | V1 | If verification contradicts an apparent success, the task must remain open and enter recovery. | Missing ticket number after a booking attempt triggers investigation rather than completion. |
| AUD-010 | P0 | V1 | Evidence retention must follow data sensitivity, user settings, organizational policy, and legal hold. | Retention jobs preserve required audit metadata and delete optional screenshots on schedule. |
| AUD-011 | P0 | V1 | Operators must have tamper-evident privileged access logs. | Every support or administrative data access is attributable and reviewable. |
| AUD-012 | P2 | End State | The platform should support cryptographically signed outcome receipts for external reliance. | A verifier can validate signature and artifact hashes. |

# System Architecture

## Reference Technology Stack

| Layer | Reference implementation |
| --- | --- |
| Mobile | React Native with TypeScript using Expo prebuild/custom development client; native Swift/Kotlin modules for secure storage, OAuth callback, push, device commands, share extension, and platform intents. |
| API/control plane | NestJS with Fastify adapter, OpenAPI, OIDC middleware, REST plus SSE/WebSocket for live events. |
| Durable workflows | Temporal TypeScript SDK and Temporal Cloud or self-hosted production cluster. |
| Agent runtime | TypeScript worker service with model gateway, context compiler, planner, verifier, tool router client, and evaluation hooks. |
| Primary model | Meta Model API, default model `meta/muse-spark-1.1`, behind `ModelProvider` interface. |
| Tool gateway | TypeScript service with JSON Schema/Zod validation, OPA policy calls, idempotency, rate limits, circuit breakers, and normalized results. |
| Composio | Current TypeScript SDK sessions/connected accounts; hosted Connect Link or operator-owned OAuth apps. |
| Browser | Playwright Chromium/Firefox/WebKit workers in isolated containers; WebRTC or secure streaming for takeover. |
| Code sandbox | Kubernetes Jobs with gVisor/Firecracker-grade isolation in production; local Docker provider for development; restricted egress and ephemeral credentials. |
| Document/media worker | Python service using LibreOffice, PyMuPDF, python-docx, openpyxl, python-pptx, Pillow, FFmpeg, parsers, and format-specific QA. |
| Data | PostgreSQL 16 with pgvector and row-level tenant isolation; Redis for locks/cache/live fan-out; S3-compatible object storage. |
| Secrets | Cloud KMS plus Secrets Manager or Vault; envelope encryption for native OAuth tokens and browser state. |
| Policy | Open Policy Agent with versioned Rego bundles and a product risk classifier. |
| Observability | OpenTelemetry, Prometheus/Grafana, trace backend, structured logs, Sentry-style mobile/backend error tracking. |
| Infrastructure | Kubernetes, Terraform, GitHub Actions, signed containers, SBOMs, staged environments, feature flags via OpenFeature. |

## Service Boundaries

| Service | Responsibilities | Must not do |
| --- | --- | --- |
| Mobile app | Display state, collect user intent, attachments, OAuth, approvals, secure local actions. | Own durable task state; store raw external tokens; claim unsupported device actions. |
| API gateway | Authenticate, authorize endpoint access, validate request envelopes, rate-limit, issue streams. | Run long agent tasks or untrusted code. |
| Task service | Conversation/task CRUD, snapshots, event append, action requests, search. | Call provider tools directly. |
| Workflow service | Durable state machine, timers, retries, signals, compensation orchestration. | Store secrets in workflow history. |
| Agent runtime | Plan, retrieve memory, select tools, interpret observations, define verification. | Bypass tool gateway or policy. |
| Model gateway | Provider API, context budget, streaming, validation, usage and model metadata. | Hold user OAuth grants or execute side effects. |
| Memory service | Write governance, hybrid retrieval, provenance, conflict and user controls. | Store prohibited secrets or infer authority. |
| Tool gateway | Validate, authorize, lease credentials, execute adapters, normalize results. | Expose raw credentials to model or adapter logs. |
| Credential broker | OAuth lifecycle, token encryption, scoped leases, session-state injection. | Return raw secrets to agent prompts. |
| Browser worker | Web operation, downloads/uploads, evidence, takeover. | Access cross-tenant browser state or protected kernel. |
| Sandbox worker | Build/test generated code and process untrusted files. | Access production control plane or unrestricted network. |
| Artifact service | Object storage, versions, previews, checksums, evidence, retention. | Execute uploaded content. |
| Notification service | APNs/FCM dispatch, templates, dedup, receipt tracking. | Decide policy or advance workflows without a user signal. |

## Durable Workflow Rationale

A task may wait for days and must resume after application, worker, or infrastructure failure. A durable workflow engine records state transitions, timers, retries, and human signals. Temporal describes workflow executions as durable and recoverable, and its signal/update patterns are designed for waiting on external events or corrected human input. [R11][R12][R13]

Workflow history must contain only deterministic state, non-secret identifiers, and encrypted artifact references. Provider tokens, full documents, model prompts, and large outputs must remain outside workflow history.

# Data Architecture

## Core Entities

| Entity | Key fields |
| --- | --- |
| User | id, tenant_id, profile, locale, timezone, identity_provider_id, status, created_at. |
| Device | id, user_id, platform, push_token_handle, public_key, capabilities, permissions, last_seen, status. |
| Conversation | id, tenant_id, owner, title, participants, created_at, archived_at. |
| Message | id, conversation_id, author_type, content blocks, attachment IDs, created_at, client idempotency key. |
| Task | id, conversation_id, objective, constraints, success criteria, state, risk, budget, deadline, current_step, workflow ID, snapshot version. |
| TaskEvent | id, task_id, sequence, type, actor, public payload, private encrypted payload handle, timestamp, digest. |
| ActionRequest | id, task_id, type, material payload digest, options, risk, approvers, expiry, state, response. |
| ToolDefinition | name, version, provider, schemas, auth, scopes, risk, verification, egress, status. |
| ToolExecution | id, task_id, step_id, tool version, connection, policy decision, idempotency key, status, result/evidence handles. |
| Connection | id, user/tenant, provider, source, account label, scopes, token handle, status, last used, expiry, health. |
| Artifact | id, tenant, owner, original name, MIME, hash, size, storage key, sensitivity, scan state, parent/version. |
| ArtifactRepresentation | artifact_id, kind, parser version, page/sheet/slide/timestamp range, storage key, text index. |
| MemoryItem | id, tenant, user, kind, subject, predicate, object, text, scope, confidence, sensitivity, validity, status. |
| MemorySource | memory_id, source type/id, excerpt handle, author, timestamp, extraction version. |
| EntityNode/Relation | canonical entity, aliases, attributes, relation type, validity, provenance. |
| Evidence | id, task, step, type, artifact/data handle, content hash, captured_at, verifier, signature. |
| GeneratedCapability | id, package, version, source docs, code artifact, tests, SBOM, signer, rollout state. |
| PolicyBundle/Decision | versioned rules and per-action decision with reason and material digest. |

## Representative Task Event Types

`task.created`, `task.planning_started`, `task.plan_created`, `task.state_changed`, `step.started`, `step.completed`, `tool.discovery_started`, `tool.selected`, `tool.execution_started`, `tool.execution_succeeded`, `tool.execution_failed`, `tool.timeout`, `tool.retry_scheduled`, `route.changed`, `connection.required`, `connection.completed`, `credential.input_requested`, `browser.started`, `browser.takeover_requested`, `browser.resumed`, `approval.requested`, `approval.responded`, `external.wait_started`, `external.event_received`, `memory.proposed`, `memory.saved`, `memory.superseded`, `artifact.uploaded`, `artifact.parsed`, `artifact.generated`, `code.diff_created`, `tests.started`, `tests.failed`, `tests.passed`, `capability.deployed`, `capability.rolled_back`, `verification.started`, `verification.failed`, `verification.succeeded`, `task.completed`, `task.failed`, `task.cancelled`.

## Representative Public Event Schema

```json
{
  "event_id": "evt_...",
  "task_id": "task_...",
  "sequence": 184,
  "type": "tool.execution_failed",
  "occurred_at": "2026-07-18T14:03:22.141Z",
  "actor": {"type": "tool_gateway", "id": "gateway-prod"},
  "visibility": "user",
  "summary": "The carrier rejected a required field.",
  "details": {
    "tool": "carrier.change_delivery_date@1.0.0",
    "status_code": 422,
    "error_class": "validation",
    "retryable": true,
    "next_action": "Update the adapter and rerun its tests."
  },
  "secret_fields": [],
  "evidence_ids": [],
  "digest": "sha256:..."
}
```

# API Requirements

## Mobile and Control Plane Endpoints

| Method and path | Purpose |
| --- | --- |
| POST /v1/conversations | Create conversation. |
| GET /v1/conversations | List/search conversations and task summaries. |
| GET /v1/conversations/{id} | Load messages, task snapshots, and pending actions. |
| POST /v1/conversations/{id}/messages | Send a message with attachment handles and idempotency key. |
| GET /v1/tasks/{id} | Get authoritative task snapshot. |
| GET /v1/tasks/{id}/events?after=sequence | Delta-sync ordered events. |
| GET /v1/tasks/{id}/stream | SSE stream; WebSocket may be used for bidirectional low-latency control. |
| POST /v1/tasks/{id}/pause\|resume\|cancel | User task control. |
| POST /v1/tasks/{id}/instructions | Durable instruction/constraint update. |
| GET /v1/action-requests | List pending user actions. |
| POST /v1/action-requests/{id}/respond | Approve, reject, modify, defer, or provide input; signs material digest. |
| POST /v1/uploads | Create presigned multipart upload. |
| POST /v1/uploads/{id}/complete | Finalize and queue scan/ingestion. |
| GET /v1/artifacts/{id} | Metadata and preview links. |
| GET /v1/connections | List normalized connected accounts. |
| POST /v1/connections/link | Start Composio or native OAuth connection. |
| GET /v1/connections/callback | Server callback; mobile callback uses universal/app link handoff. |
| POST /v1/connections/{id}/disable\|enable\|reauthenticate\|revoke | Connection lifecycle. |
| GET /v1/memories | Search and browse memories. |
| POST /v1/memories | Explicitly save memory. |
| PATCH /v1/memories/{id} | Edit, scope, pin, expiry, confirm, or supersede. |
| DELETE /v1/memories/{id} | Forget with derived-data cleanup. |
| GET /v1/settings | Effective settings and policies. |
| PATCH /v1/settings | Update permitted settings with version check. |
| POST /v1/devices/register | Register push token, device public key, and supported capability manifest. |
| POST /v1/device-commands/{id}/result | Return signed result/evidence from on-device executor. |
| POST /v1/security/emergency-stop | Revoke active execution leases according to scope. |

## Internal Service Contracts

All internal APIs must use mutual service identity, explicit tenant and principal claims, schema versioning, deadlines, idempotency, and trace propagation. Large payloads travel by artifact handle, not inline. Tool execution and credential lease endpoints are private and unavailable through the public API gateway.

# Security and Privacy

## Threat Model

The system must assume hostile user inputs, hostile websites, malicious documents, compromised third-party tools, prompt injection, OAuth phishing, poisoned API documentation, dependency attacks, browser session theft, confused-deputy attacks, cross-tenant access attempts, model hallucination, duplicate side effects, insider access, and compromised devices.

OWASP identifies direct and indirect prompt injection, tool abuse, privilege escalation, and data exfiltration as core agent risks. The architecture therefore places deterministic authorization, credential isolation, and sandbox boundaries outside the model. [R14][R15][R16]

## Security Controls

Mandatory controls include:

- least privilege at user, task, tool, connection, network, data, and infrastructure layers;
- no raw secrets in model prompts, workflow history, memory, analytics, crash reports, or user-visible traces;
- KMS envelope encryption and short-lived credential leases;
- mTLS/workload identity for internal services;
- signed device commands, signed adapter artifacts, signed container images, and SBOMs;
- row-level tenant isolation plus service-side authorization checks;
- restricted egress for browser and code sandboxes;
- malware scanning, archive limits, DLP, and parser isolation;
- input and output schema validation, size limits, timeouts, and rate limits;
- explicit separation of instructions from untrusted content;
- approval binding to immutable material-action digests;
- immutable audit and evidence hashes;
- dependency and container scanning in CI and runtime admission;
- security event detection for unusual connection use, mass actions, or policy changes;
- regular agent red-team tests, browser prompt-injection tests, and adapter supply-chain tests.

## Data Classification

| Class | Examples | Default handling |
| --- | --- | --- |
| Public | Public web pages and user-designated public content. | Standard encryption and retention. |
| Internal | Task plans, ordinary files, nonpublic preferences. | Encrypted; tenant access controls. |
| Confidential | Email, contacts, business data, private files, location. | Restricted tools, audit, redaction rules. |
| Highly sensitive | Financial, health, identity, legal, intimate, authentication-adjacent data. | Step-up auth, strict provider policy, minimal retention. |
| Secret | Passwords, tokens, private keys, cookies, recovery codes, raw card data. | Credential broker only; never model/memory/event visible. |

## Privacy Controls

Users and organizations must be able to configure retention, disable implicit memory, inspect and delete memory, revoke connections, export data, remove artifacts and derived indexes, manage model-use policy, and review third-party disclosures. Privacy notices must explain that the backend operates continuously while tasks are active and that external services receive only data required for authorized actions.

# Reliability, Performance, and Scalability

## Service-Level Objectives

| Area | Initial production objective |
| --- | --- |
| Control-plane availability | 99.9% monthly; 99.95% target after stabilization. |
| Durable task state | No acknowledged task/event loss; RPO 0 for committed database and workflow events. |
| Workflow recovery | Resume worker processing within 5 minutes of recoverable regional/service incident, excluding provider outage. |
| Open-app live event latency | p95 under 2 seconds from committed event to connected client. |
| Reconnect state load | p95 under 3 seconds for task snapshot plus recent event delta on typical mobile network. |
| Action-required notification enqueue | p95 under 5 seconds after durable `WAITING_USER` transition. |
| Memory retrieval | p95 under 500 ms for standard hybrid retrieval before model call; larger graph jobs may use async preprocessing. |
| Tool gateway overhead | p95 under 150 ms excluding provider execution and policy cold start. |
| Idempotency retention | At least the longer of provider window, task lifetime, or configured financial replay period. |
| Upload integrity | 100% checksum verification; resumable multipart for large files. |
| Emergency stop | Block new privileged tool leases within 5 seconds; best-effort cancellation of in-flight provider operations. |

## Scalability

- Stateless API and worker processes scale horizontally.
- Temporal task queues separate interactive, browser, code, document, and low-priority work.
- Browser and sandbox capacity use quotas and per-tenant concurrency limits.
- PostgreSQL is partitioned by event date/tenant as volume grows; object storage holds large payloads.
- Redis is nonauthoritative and may be rebuilt.
- Model and tool budgets prevent runaway cost.
- Standing objectives use event triggers and durable timers rather than frequent model polling.
- Backpressure must degrade gracefully by queueing work, communicating expected delay, and prioritizing pending user actions and security events.

# Observability and Operations

| ID | Priority | Release | Requirement | Acceptance / verification |
| --- | --- | --- | --- | --- |
| OPS-001 | P0 | V1 | All services must emit OpenTelemetry traces with task, step, tool, tenant, and provider correlation, excluding secrets. | A task can be traced across API, workflow, agent, tool, and notification services. |
| OPS-002 | P0 | V1 | Metrics must cover task state, queue delay, model usage, tool latency, provider failures, memory retrieval, OAuth health, browser sessions, sandbox tests, approvals, and verification. | Dashboards and alerts exist for each production-critical subsystem. |
| OPS-003 | P0 | V1 | Logs must be structured, redacted, retention-controlled, and separated by sensitivity. | Secret fixtures are removed before log storage and log access is audited. |
| OPS-004 | P0 | V1 | The system must provide an operator console separate from the consumer mobile app. | Authorized operators can inspect service health and task metadata without reading content by default. |
| OPS-005 | P0 | V1 | Support access to user content must require just-in-time authorization, reason, expiry, and audit. | No standing broad support role can browse content. |
| OPS-006 | P0 | V1 | Provider health and adapter health must affect routing and user status. | A degraded provider is marked and new tasks avoid it when alternatives exist. |
| OPS-007 | P0 | V1 | Every production incident must support replay from non-secret event and evidence history. | Incident tooling reconstructs steps without exposing raw credentials. |
| OPS-008 | P0 | V1 | The system must support feature flags and tenant canaries for models, tools, and workflows. | A faulty rollout can be disabled without mobile release. |
| OPS-009 | P0 | V1 | Automated backups and restore drills must cover database, object storage metadata, workflow state, policy, and registry. | Quarterly restore tests meet RPO/RTO targets. |
| OPS-010 | P0 | V1 | Cost observability must attribute model, browser, sandbox, storage, and third-party tool spend to tenant and task. | A task receipt and admin dashboard can show cost categories. |

# Testing and Evaluation Strategy

## Conventional Testing

- unit tests for schemas, policy, routing, memory logic, event rendering, and state transitions;
- integration tests for PostgreSQL, Temporal, Redis, object storage, Composio, OAuth callbacks, APNs/FCM stubs, and model gateway;
- consumer-driven contract tests for every tool adapter;
- mobile UI and deep-link tests on real/simulated iOS and Android devices;
- browser fixtures and recorded provider sandboxes;
- document corpus tests for PDFs, spreadsheets, decks, images, archives, audio, and video;
- security tests for token leakage, tenant isolation, prompt injection, egress, replay, SSRF, malicious files, and generated dependencies;
- load, soak, chaos, disaster-recovery, and backup-restore tests;
- accessibility tests for mobile UI and generated web/operator UI.

## Agent and Memory Evaluation

| Evaluation suite | Measure |
| --- | --- |
| Task completion | Verified outcome rate, not self-reported success. |
| Tool selection | Correct route, correct account, minimum scopes, cost/latency tradeoff. |
| Failure recovery | Duplicate avoidance, adaptation quality, bounded retries, escalation correctness. |
| Approval correctness | High-risk recall, low-friction precision, stale approval invalidation. |
| Memory precision | Relevant memory use without unrelated or sensitive leakage. |
| Memory recall | Reliable retrieval of explicit facts such as canonical URLs and procedures. |
| Memory correction | Superseded facts stop influencing current tasks. |
| Browser robustness | Success across DOM changes, popups, downloads, MFA handoff, and prompt injection. |
| Generated adapters | Compile/test pass, sandbox correctness, idempotency, security, and canary reliability. |
| Trace truthfulness | Every user-visible claim corresponds to an event/evidence record. |
| Model regression | Outcome, safety, latency, cost, and tool-call comparison before model upgrades. |

## Critical End-to-End Acceptance Scenarios

1. **Offline return:** Start a multi-step task, turn off the phone, let the backend progress, require approval, turn the phone on, open the notification, approve, and verify completion.
2. **One-time OAuth:** Connect Gmail once through the mobile flow, close the app, start a later task, and reuse the same connection without asking for credentials.
3. **Persistent memory:** State the work-call logging URL, start a new conversation days later, ask to log a call, and verify the correct URL is used with provenance.
4. **Browser fallback:** Request an action on a service without an API, log in through secure takeover, allow autonomous navigation, approve the final submission, and independently verify it.
5. **Adapter generation:** Supply an official sandbox API with documentation, let the agent generate an adapter, fail a test, repair it, pass the suite, request approval, canary, and resume the original task.
6. **File ingestion:** Upload a PDF with a chart, a workbook with formulas, and a photo; ask a cross-file question; verify page/range/image provenance.
7. **Duplicate protection:** Force a timeout after a purchase submission; verify provider state before any retry and produce only one purchase.
8. **Prompt injection:** Place malicious instructions in a webpage and PDF; ensure the agent treats them as data and cannot access unrelated tools or secrets.
9. **Connection revocation:** Revoke a provider connection while a task waits; ensure the task pauses and no cached credential remains usable.
10. **Device constraint honesty:** Request an unsupported silent iOS message send; the system must offer a supported compose/provider route and not claim success without confirmation.

# Deployment and DevOps

## Environments

| Environment | Purpose |
| --- | --- |
| Local | Docker Compose for Postgres/pgvector, Redis, MinIO, Temporal dev server, API, workers, mock model, mock OAuth, and browser fixtures. |
| Development | Shared cloud environment with test credentials and synthetic data. |
| Staging | Production-like network, KMS, OAuth apps, push sandbox, provider sandboxes, security gates, and canaries. |
| Production | Multi-AZ managed databases, durable workflows, isolated worker pools, autoscaling, backups, WAF, secrets, monitoring, incident response. |

## CI/CD Requirements

- lint, type-check, unit, integration, contract, mobile, and security tests;
- migration validation and rollback tests;
- container build with minimal base images, SBOM, vulnerability and license scans;
- artifact signing and admission verification;
- infrastructure plan and policy checks;
- staged deployment with health checks, canary, automatic rollback, and manual approval for protected services;
- generated capability deployments use a separate pipeline and identity from core application deployment;
- no production secrets in CI logs or pull-request environments.

## Disaster Recovery

The production design must provide multi-AZ primary services, encrypted backups, point-in-time database recovery, object versioning, workflow persistence, infrastructure-as-code recreation, credential-rotation procedures, and tested regional recovery. External provider actions cannot always be rolled back; disaster procedures must verify provider state before replaying pending activities.

# Mobile Platform Constraints and Editions

## Consumer Store Edition

The consumer edition must comply with public app-store rules. The cloud agent performs persistent work. The device executor uses only official platform capabilities and visible user consent. iOS background processing is limited and event-driven; Android persistent work uses WorkManager or foreground services under platform rules. General autonomous Android AccessibilityService operation is not an acceptable core mechanism for a Play-distributed general assistant. [R8][R9][R10]

## Enterprise Managed Edition

A separate enterprise edition may integrate MDM, managed app configuration, device-owner APIs, organization-controlled certificates, private app distribution, and approved deterministic device automations. Its capability registry and policy namespace must be distinct so enterprise-only device controls can never be routed to consumer devices.

## Provider Policy Matrix

Every communication, social, financial, smart-home, and account-management integration requires a provider policy record stating permitted actions, automation restrictions, rate limits, required disclosures, and supported verification. Technical ability is insufficient; the product must also have authority under the provider’s terms and the user’s policy.

# Release Plan

## Phase 0: Security and Durable Foundation

Build identity, tenant isolation, PostgreSQL, object storage, Temporal, event schema, mobile shell, push registration, model gateway interface, policy service, secrets boundary, observability, and local development environment.

## Phase 1: Production Vertical Slice

Ship Chat + Settings, durable tasks, live feed, notifications, action requests, one-time OAuth through Composio, native Gmail/Calendar example, Meta Muse Spark 1.1 provider, basic memory, attachments, Playwright browser, evidence, and a complete “research -> request approval -> perform action -> verify” workflow.

## Phase 2: Memory and Multimodal Depth

Add semantic/episodic/procedural memory, memory Settings UI, entity graph, conflict resolution, PDF/document/spreadsheet/presentation/media ingestion, artifact editing, and broader native integrations.

## Phase 3: Safe Self-Extension

Add official documentation discovery, OpenAPI adapter generation, disposable code sandboxes, full test gates, signing, tenant canary, registry versioning, rollback, and resumable capability acquisition.

## Phase 4: Device and Standing Objectives

Expand App Intents, Android intents, Home/Matter, share extensions, managed-device edition, standing objectives, trigger monitoring, agent-to-agent protocols, and policy-driven economic authority.

## Phase 5: Accountable Outcomes

Introduce outcome pricing, guarantees, insurance, signed receipts, organization-wide procedures, capability marketplace, and continuous state-maintenance products.

# Production Readiness Exit Criteria

The V1 production baseline is ready only when:

- the app can be force-quit during a task and later reconstruct exact live state;
- a task can wait for a user for at least seven days and resume at the correct continuation;
- Composio/native OAuth connects once, refreshes, and can be revoked;
- raw secrets are absent from model, event, memory, and log surfaces in automated leakage tests;
- the explicit memory example is retrieved correctly across conversations and can be edited or forgotten;
- at least PDF, DOCX, XLSX/CSV, PPTX, common images, text/code, and audio inputs pass the ingestion corpus;
- a browser task supports secure login, takeover, final approval, and independent verification;
- the generated-adapter pipeline can create and safely deploy a read-only sandbox API adapter, with failure/retest evidence;
- state transitions, idempotency, duplicate prevention, cancellation, and emergency stop pass chaos tests;
- mobile deep links and push notifications work from foreground, background, terminated, and offline-return states;
- tenant-isolation, prompt-injection, SSRF, malicious-file, browser-state, and generated-code security tests pass;
- dashboards, alerts, backups, restore drills, runbooks, privacy controls, and incident response are operational;
- platform-specific marketing accurately states device limitations.

# Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Model API changes or regional availability | Primary model calls fail or behavior changes. | Provider abstraction, pinned API version, canary evaluation, explicit configured fallback, clear outage state. |
| Overbroad authority | Financial, reputational, or privacy harm. | Deterministic policy, least privilege, action digests, recent auth, limits, emergency stop. |
| Prompt injection from web/files/email | Tool misuse or data exfiltration. | Untrusted-data boundary, egress policy, tool isolation, DLP, no secret context, adversarial tests. |
| Duplicate side effects after timeout | Double purchase, message, or booking. | Idempotency keys, durable checkpoints, provider-state verification before retry. |
| Browser fragility | Failed tasks or wrong clicks. | API-first routing, accessibility DOM, approval before material action, evidence, regression skills, takeover. |
| Generated integration supply chain | Malicious or vulnerable code. | Official docs, restricted sandbox, SBOM, dependency policy, signing, canary, rollback, protected kernel. |
| Memory falsehood or staleness | Incorrect future actions. | Provenance, confidence, validity, conflict state, user controls, freshness rules, retrieval evaluation. |
| OAuth/token compromise | External account takeover. | System browser, PKCE/state, KMS, short leases, refresh monitoring, revocation, no model exposure. |
| Mobile store restrictions | Promised device actions unavailable. | Capability matrix, consumer/enterprise editions, official intents/APIs, truthful fallback. |
| Cost runaway | Unsustainable unit economics. | Task budgets, event-driven waits, output offloading, routing, quotas, model/tool cost attribution. |
| User trust collapse from opaque behavior | Low adoption and high support. | Structured trace, evidence, reversible actions, progressive authority, visible memory and connection controls. |

# Open Product Decisions

These decisions do not block the architecture but must be finalized before public launch:

- final product and company name;
- target launch geography and Meta Model API availability;
- app account identity provider;
- managed cloud choices and whether Temporal is managed;
- launch-native integrations beyond email/calendar/storage;
- consumer pricing and task budgets;
- default memory retention and implicit-memory setting;
- default approval thresholds and supported financial actions;
- whether browser sessions are self-hosted or use a managed provider;
- support and incident access model;
- legal review of social messaging, automated transactions, and provider terms.

# Codex Build Prompt Usage

A separate master prompt accompanies this FRD. Place the Markdown version of this FRD at `docs/FRD.md`, paste the master prompt into Codex from the repository root, and allow it to work in ordered phases. The prompt requires Codex to implement real interfaces, mocks for credential-dependent external systems, complete tests, local infrastructure, CI, documentation, and a production vertical slice. It expressly prohibits fake tool success, raw-secret logging, arbitrary core self-modification, and unsupported mobile claims.

# Implementation References

The following references support vendor- and platform-specific statements in this document. Product requirements remain authoritative even if an external API changes; implementations must verify the current official documentation during development.

- **[R1] Meta for Developers, “Build with Muse Spark, now available on Meta Model API,” 8 July 2026.** https://developer.meta.com/ai/resources/blog/build-with-muse-spark/
- **[R2] Meta for Developers, “Muse Spark” model page.** https://developer.meta.com/ai/models/muse-spark/
- **[R3] Composio, “Connected Accounts.”** https://docs.composio.dev/reference/v3/api-reference/connected-accounts
- **[R4] Composio, “Authenticating Tools.”** https://docs.composio.dev/docs/tools-direct/authenticating-tools
- **[R5] Composio, “How Composio Works / Sessions and Authentication.”** https://docs.composio.dev/docs/how-composio-works
- **[R6] Playwright, “Playwright MCP.”** https://playwright.dev/docs/getting-started-mcp
- **[R7] Playwright, “Authentication.”** https://playwright.dev/docs/auth
- **[R8] Apple Developer, “Background Tasks.”** https://developer.apple.com/documentation/backgroundtasks
- **[R9] Android Developers, “Task scheduling / WorkManager.”** https://developer.android.com/develop/background-work/background-tasks/persistent
- **[R10] Google Play, “Use of the AccessibilityService API.”** https://support.google.com/googleplay/android-developer/answer/10964491
- **[R11] Temporal, “Workflow Execution overview.”** https://docs.temporal.io/workflow-execution
- **[R12] Temporal, “Delayed Callback (Webhooks).”** https://docs.temporal.io/design-patterns/delayed-callback
- **[R13] Temporal, “Resumable Activity.”** https://docs.temporal.io/design-patterns/resumable-activity
- **[R14] OWASP, “AI Agent Security Cheat Sheet.”** https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
- **[R15] OWASP, “LLM Prompt Injection Prevention Cheat Sheet.”** https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- **[R16] OWASP, “MCP Security Cheat Sheet.”** https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html
- **[R17] OpenAPI Initiative, OpenAPI Specification.** https://spec.openapis.org/oas/latest.html

# Glossary

| Term | Definition |
| --- | --- |
| Action request | A durable, typed request for user authority or information. |
| Adapter | Code that implements a typed tool contract against an external API or service. |
| Agent runtime | The backend component that interprets objectives and coordinates tools under policy. |
| Artifact | A user or system file, normalized representation, generated document, or evidence object. |
| Capability | An authorized action the system can perform through a registered tool. |
| Capability gap | A typed record describing a required action for which no usable tool currently exists. |
| Connection | A user- or organization-authorized external account, usually established through OAuth. |
| Context compiler | The service that assembles the minimal task, memory, artifact, policy, and tool context for a model call. |
| Credential broker | The protected service that stores or leases credentials without exposing raw values to the model. |
| Evidence | Immutable information proving what occurred or what state exists. |
| Execution trace | User-visible structured events showing operational progress, errors, adaptations, and results. |
| Memory provenance | The source and history explaining why a durable memory exists. |
| On-device executor | Reviewed mobile code that performs signed, supported local actions. |
| Outcome verification | An independent check that the user’s success criteria are satisfied. |
| Protected kernel | Identity, policy, secrets, audit, billing, deployment, and isolation code that agents cannot self-modify. |
| Standing objective | A persistent desired state monitored over time. |
| Tool gateway | The sole execution boundary for external and privileged capabilities. |
| Workflow signal | A durable external event that resumes or updates a long-running task. |
