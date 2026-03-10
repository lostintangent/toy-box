This project is a full-stack web application built with Bun, TanStack Start/Router/Query, React, Tailwind, ShadCN, and the GitHub Copilot SDK.

## Writing Great Tests

- Prefer `test(...)` + `describe(...)` from `bun:test` for consistency.
- Test user-visible behavior and lifecycle contracts, not private implementation details.
- Keep tests deterministic: inject seams (timeouts/dependencies) only where needed.
- Use `onTestFinished(...)` for per-test cleanup instead of shared mutable teardown state.
- For timer-driven behavior, use short real timers (`Bun.sleep(...)`) with explicit test timeouts; Bun does not fully mock timeout APIs yet.
- Keep test names concrete and scenario-based (what behavior is guaranteed).
- Avoid over-mocking; use small fakes that preserve protocol shape and failure modes.

## Post-Change Checklist

- Run `bun format` and fix any formatting issues.
- Run `bun lint` and fix any lint issues.
- Run `bun check` and fix any typecheck issues.
- Run `bun test` and fix any failing tests.
- For significant changes, dogfood the change with the `dogfood` skill.
