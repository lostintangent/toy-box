# Toy Box Dogfooding Checklist

## Setup

1. Start app:
   - `bun dev`
2. Open one or more browser sessions:
   - `playwright-cli --session tabA open http://localhost:3100`
   - `playwright-cli --session tabB open http://localhost:3100`

Use separate session names (`tabA`, `tabB`, `mobile`) to emulate multiple clients.

## Playwright CLI Quick Reference

```bash
# Navigation
playwright-cli --session test open <url>
playwright-cli --session test reload

# Interactions (use refs from snapshot)
playwright-cli --session test click <ref>
playwright-cli --session test fill <ref> "text"
playwright-cli --session test type "text"
playwright-cli --session test press Enter

# Debugging
playwright-cli --session test snapshot    # Current UI tree + refs
playwright-cli --session test console     # Browser console errors/logs
playwright-cli --session test network     # Network requests

# Cleanup
playwright-cli --session test session-stop
playwright-cli session-stop-all
```

## Typical Workflow

1. `playwright-cli --session test open http://localhost:3100`
2. `playwright-cli --session test snapshot`
3. Interact using refs from snapshot output.
4. Snapshot again and verify expected state.
5. Check `console` and `network` for regressions.

## Must-Pass Scenarios

### Sessions List (Global State)

1. Baseline list loads with sessions metadata.
2. New draft session appears immediately after clicking `New`.
3. First message in draft transitions cleanly to persisted session state.
4. Streaming state updates quickly (`session.running` -> `session.idle`) in list.
5. Unread state appears when a session finishes while not open.
6. Opening an unread session clears unread state.
7. Deleting a session removes it from list and open panes.

### Session Detail (Open Session / Grid)

1. Opening a historical session hydrates messages from baseline without duplicate replay.
2. Sending a message starts streaming immediately and updates content incrementally.
3. Stop action ends active streaming and returns to idle UI quickly.
4. Queue/cancel behavior works while streaming (enqueue and cancel queued prompt).
5. Background and return flow preserves correctness:
   - hide/disconnect while streaming
   - return and recover latest state
   - final response visible without manual refresh
6. Reconnect/catch-up path does not lose chunks and does not duplicate content.

### Multi-Client Realtime

1. Client A sends message in existing session; Client B (same open session) sees running state quickly and receives final response.
2. Client A changes unread/read state; Client B updates accordingly.
3. Session add/delete operations propagate to other connected clients.

### Terminal (WS + PTY)

1. Terminal opens and reaches ready state.
2. Input and resize work.
3. Reconnect restores scrollback for same client session.
4. Disconnect/reconnect does not duplicate terminal streams.

## Evidence To Capture

For major refactors, capture:

1. Snapshot paths before and after key actions.
2. Console log check (no new errors).
3. Network check (expected SSE/stream/WS traffic).
4. Short pass/fail summary for each scenario group.

## Notes

- `playwright-cli` refs are snapshot-specific; refresh snapshot before interaction.
- Prefer validating with at least two active sessions (`tabA`, `tabB`) for realtime changes.
- If behavior differs between hidden/visible flows, explicitly test page visibility transitions.
