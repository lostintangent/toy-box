---
name: dogfooding
description: Validate Toy Box behavior after significant changes using Playwright CLI across multi-client sessions, streaming flows, and terminal reconnect paths. Use when changes touch session hooks/reducers/adapters/cache/server functions, SSE or streaming transport logic, list/detail data fetching and invalidation behavior, terminal WebSocket/PTY logic, or route lifecycle/page visibility handling.
---

# Dogfooding

Run Toy Box dogfooding scenarios after significant changes and report pass/fail with evidence.

## Execute Workflow

1. Confirm whether the full workflow is required:

- Run this skill when touched areas include session state, streaming transport, realtime invalidation, terminal WS/PTY, or visibility/lifecycle logic.
- If none of those areas changed, state that dogfooding was skipped and why.

2. Start local runtime and browser sessions:

- Run `bun dev`.
- Open at least two sessions:
  - `playwright-cli --session tabA open http://localhost:3100`
  - `playwright-cli --session tabB open http://localhost:3100`
- Add a `mobile` session when layout or visibility flows changed.

3. Run scenario checks:

- Use `playwright-cli --session <name> snapshot` before any `click`/`fill`/`press` actions.
- Follow all required checks in `references/validation-checklist.md`.
- Refresh snapshots after key transitions because refs are snapshot-specific.

4. Collect validation evidence:

- Capture snapshots or concrete UI observations before and after key actions.
- Check browser `console` for regressions.
- Check browser `network` for expected SSE/stream/WS traffic.
- Record a pass/fail result for each scenario group.

5. Produce report:

- Return a concise summary grouped by:
  - Sessions List
  - Session Detail
  - Multi-Client Realtime
  - Terminal (WS + PTY)
- Include reproduction steps for each failure and likely impacted area when obvious.

6. Clean up sessions:

- Run `playwright-cli --session <name> session-stop` for specific sessions or `playwright-cli session-stop-all`.
- Keep the dev server running only if user asked for continued manual testing.

## Use Reference

- Read `references/validation-checklist.md` for command quick reference, must-pass scenarios, and evidence expectations.
