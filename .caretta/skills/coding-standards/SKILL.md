---
name: coding-standards
description: "Project coding standards for tx-monitor. Use when implementing, reviewing, or refactoring code so changes stay small, readable, testable, and aligned with clear boundaries."
---

# Coding Standards

## Primary Rule

Write code that is easy to understand, easy to change, and hard to misuse. Prefer small, explicit units with clear names and one reason to change.

## Naming

Names must reveal intent.

- Use domain words from the project: packet, capture, session, host, flow, graph, edge, process, anomaly, copilot.
- Prefer specific names over generic containers: `packetCount`, `captureSession`, `selectedHostId`.
- Avoid abbreviations unless they are established protocol terms such as TCP, UDP, IP, HTTP, WS, DB, or CLI.
- Name booleans as predicates: `isLiveCapture`, `hasPersistence`, `shouldReconnect`.
- Name functions by the action they perform or the value they compute.
- Do not encode implementation details in names unless the detail is part of the contract.

## Functions

Functions should do one thing at one level of abstraction.

- Keep functions short enough that the main path is visible without scrolling.
- Extract parsing, validation, transformation, persistence, rendering, and side effects into separate functions.
- Prefer early returns for invalid or edge cases.
- Avoid hidden writes. A function that mutates state should make that obvious from its name or placement.
- Avoid boolean flag parameters that switch behavior. Split the function or pass an options object with named fields.
- Keep argument lists small. When a function needs several related values, introduce a typed object.
- Do not mix command and query behavior. A function should either answer a question or perform an action, not both.

## Modules and Boundaries

Dependencies must point inward toward stable domain logic and outward only at the edges.

- Keep packet parsing independent from WebSocket delivery, database writes, and UI rendering.
- Keep graph derivation independent from React components.
- Keep persistence code behind store/API boundaries.
- Keep copilot transport and SDK details out of UI state and core packet models.
- Keep CLI/server startup code thin; delegate behavior to testable modules.
- Do not let low-level modules import high-level orchestration modules.
- Do not let React components contain packet parsing, database rules, or copilot credential logic.

## Data Flow

Make data transformations explicit.

- Parse raw tcpdump text into typed packet events.
- Convert packet events into network state.
- Convert network state into graph nodes and edges.
- Render graph data in React.
- Persist sessions and packets through the database store.
- Send only explicit client-provided snapshots to copilot analysis.

Avoid shortcuts that couple these stages directly.

## Error Handling

Handle expected failures deliberately.

- Treat malformed tcpdump lines as non-events or typed parse failures, not crashes.
- Surface missing tcpdump, permission failures, missing files, database failures, and copilot failures with actionable messages.
- Do not swallow errors silently.
- Do not leak secrets, environment values, API keys, or raw copilot payloads in logs.
- Prefer typed results or explicit null/undefined handling over exceptions for common parse misses.

## Comments

Comments should explain why, not restate what the code says.

- Use comments for protocol quirks, platform-specific tcpdump behavior, security/privacy reasoning, and non-obvious tradeoffs.
- Delete comments that merely repeat the implementation.
- If a comment is needed to explain tangled code, prefer simplifying the code first.

## Tests

Tests should lock down behavior at subsystem boundaries.

- Parser changes require tcpdump fixture coverage.
- Graph changes require node/edge identity and aggregation coverage.
- Layout changes require deterministic-position expectations where practical.
- Persistence changes require session and packet round-trip coverage.
- Copilot changes require auth, timeout, payload, redaction, and failure-path coverage.
- UI behavior should be tested at the smallest stable seam rather than through brittle implementation details.

## Refactoring

Refactor in small, behavior-preserving steps.

- Keep public contracts stable unless the change is intentional and documented.
- Improve names before changing structure.
- Extract pure logic before changing side effects.
- Avoid broad rewrites when a targeted seam would solve the problem.
- Do not introduce abstractions before there are real repeated concepts to unify.

## TypeScript Standards

Use TypeScript to make invalid states difficult to represent.

- Prefer precise types over `any`.
- Use discriminated unions for variant states.
- Use readonly data where mutation is not required.
- Keep nullable values close to the boundary where they enter the system.
- Validate untrusted input before it reaches core logic.
- Avoid type assertions unless the surrounding code proves the assertion.

## React Standards

Components should be presentation and interaction units, not business logic containers.

- Keep packet, graph, and persistence rules outside components.
- Use hooks for browser-side orchestration and state wiring.
- Keep component props specific and typed.
- Avoid derived state when it can be computed from source state.
- Keep rendering stable under high-frequency packet updates.

## Bun Server Standards

Server code should make lifecycle and side effects explicit.

- Separate startup, route handling, capture ingestion, WebSocket delivery, and persistence.
- Prefer deterministic file replay for development and tests.
- Do not run live capture or privileged commands from tests.
- Keep request handlers small and delegate validation and business behavior.
- Respect `--no-db`, `--file`, `--port`, `--serve`, and environment-based configuration consistently.

## Security and Privacy

Network metadata is sensitive local data.

- Do not log secrets or environment values.
- Do not send ambient traffic to external services by default.
- Keep copilot analysis opt-in and snapshot-based.
- Redact tokens, keys, and credentials before display or transmission.
- Avoid storing more packet/process detail than the feature requires.

## Review Checklist

Before considering a change complete, verify:

- Names describe intent.
- Each function has one clear responsibility.
- Core logic is separated from framework, transport, and persistence details.
- Error paths are explicit.
- Sensitive data is not logged or transmitted unexpectedly.
- Tests cover the changed boundary.
- The change fits the local-first traffic-visualization product frame.
