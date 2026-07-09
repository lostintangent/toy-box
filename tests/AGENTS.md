# Golden Tests

Golden tests protect the two pipelines behind a central Toy Box promise: Copilot activity should produce the same session whether it is watched live or reconstructed from history. They play back real, sanitized Copilot sessions through production history, projector, reducer, and runtime code with narrow boundary mocks, then lock each result with Bun snapshots.

Unit tests remain beside their source files to localize projector, reducer, runtime, and protocol failures. These project-level tests exercise the whole pipeline in its two consumption modes:

- `history.golden.test.ts` feeds raw SDK events through history replay, the stateful projector, and the session reducer to produce the idle `Session` the server returns for a recorded session.
- `stream.golden.test.ts` feeds raw SDK events through a two-delivery `SessionStream` lifetime, including projection, reduction, event and agent-loop segment identity, queue draining, shared updates, and teardown. Nondeterministic IDs are normalized to stable ordinals.

Both modes assert named invariants before snapshotting their complete output. An invariant failure explains what contract broke; the snapshot diff shows where that pipeline changed. Shared conversation-shape invariants, including subagent grouping, must agree because both modes use the same projector and reducer. The stream suite separately proves that snapshot-seeded resume converges with uninterrupted streaming across deliveries.

When mocking modules here, provide their complete export surface. Bun's `mock.module` remains active for the test process, so a partial replacement can corrupt unrelated suites.

## Updating snapshots

After an intentional behavior change, run `bun test -u` and review the `.snap` diff like any other code change. Snapshot acceptance is not a substitute for checking the named invariants.

## Adding a fixture

Fixtures are contiguous, sanitized slices of real `events.jsonl` logs. Truncate user content and remove `encryptedContent`, `reasoningOpaque`, and `toolTelemetry` before committing them.

When Toy Box misrenders a real session, curate the smallest event slice that preserves the behavior, add named invariants for the regression, and snapshot the complete result. `fixtures/subagents.jsonl` is the canonical complex fixture: parallel background agents, todo SQL, failure, compaction, and interleaved subagent activity.
