# Golden tests

Project-level snapshot tests that replay **real, sanitized Copilot CLI sessions**
(committed under `fixtures/`) end-to-end and lock the output with Bun
snapshots. Unit tests live beside their source files and localize regressions
to a layer (projector / sessionReducer / SessionStream); the goldens here lock
the full pipeline — one per consumption mode:

- `history.golden.test.ts` — the resume/replay mode: raw SDK events →
  history replay adapter (historyReplay.ts) → streaming projector →
  sessionReducer → final `Session`, via the same production entry point the
  server uses to open a recorded session.
- `stream.golden.test.ts` — the live mode: raw SDK events → SessionStream
  (projector streaming → reducer → eventId/turnId decoration, buffering,
  queue draining, global broadcast ordering, teardown) through a full two-turn
  lifetime. Nondeterministic ids are normalized to ordinals. When mocking
  modules here, cover the FULL export surface — `mock.module` persists for
  the rest of the bun test process and partial mocks poison later suites.

Both modes assert the same convergence invariants (subagent work grouped
under agent calls) — they must agree on the conversation shape, because the
server and client share the reducer. Each test asserts named invariants first
(so a failure says _what behavior_ broke), then snapshots the full output (so
the diff says _where_).

## Updating snapshots

After an intentional behavior change: `bun test -u`, then review the `.snap`
diff in code review like any other artifact.

## Adding a fixture

Fixtures are contiguous-order, sanitized slices of real `events.jsonl` session
logs (strings truncated, `encryptedContent`/`reasoningOpaque`/`toolTelemetry`
stripped). The playbook: when toy-box misrenders a real session, curate a
minimal slice of that session's events into `fixtures/`, add invariants for
the behavior it exposes, and snapshot it. `fixtures/subagents.jsonl` is the
session that exposed the v1 `agentId` grouping regression: 7 parallel
background subagents, todo SQL, a failed tool call, compaction, and
interleaved subagent tool calls/messages.
