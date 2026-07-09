---
name: react-review
description: Review Toy Box React components and hooks with React Compiler diagnostics, lifecycle tracing, and the project's React pattern catalog. Use whenever a task creates, modifies, or reviews a React component or React-based hook—including its relevant owners and consumers—or diagnoses resets, stale state, effects, rerenders, memoization, Jotai subscriptions, or React Query state.
---

# React Review

Use the project's Writing Great Code section as the design standard and [references/principles.md](references/principles.md) as the source of React-specific guidance. This skill defines only the review procedure.

## Review workflow

1. Build the review set.
   - Start with every changed component and React hook.
   - Include the nearest owner when a `key`, conditional, route, dialog, or pane controls its mounted identity.
   - Include direct consumers when a changed hook exposes values or functions, and include relevant Jotai atoms or React Query definitions when they own the state being consumed.
2. Run `bun lint` before editing.
   - The `react/react-compiler` rule reports every React Compiler bailout as an error.
   - `toy-box-react/no-manual-memoization` rejects `memo`, `useMemo`, and `useCallback`; the TanStack plugins check Query and Router usage.
   - Treat diagnostics as locations to investigate. Understand the cause before changing code or adding a targeted suppression.
3. Inspect the review set.
   - Use the review map in [references/principles.md](references/principles.md), then read every section matching the code under review. Read the reference completely for broad audits.
   - Trace each affected behavior through its owner and consumers, including entity changes, mount and unmount, user actions, external updates, async completion, and cleanup where applicable.
   - Compare the behavior with focused tests and inspect committed behavior when checking a suspected regression.
4. Apply only concrete findings.
   - Use the project standard and React reference to choose the smallest behavior-preserving correction.
   - Re-run `bun lint` after editing and resolve every new Compiler, React, Query, or Router diagnostic.
5. Complete the Definition of Done in `AGENTS.md`. For review-only requests, report only concrete behavioral risks or meaningful clarity improvements.
