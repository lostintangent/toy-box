---
name: review
description: Review Toy Box code for concrete architectural, lifecycle, and state-management risks against its design standards and React, TanStack, and Jotai patterns. Use when the user explicitly requests a code review or audit, or when implementation materially changes a domain or public contract, runtime schema, session/stream/request lifecycle, persistence or concurrency behavior, cache/query semantics, shared state ownership, or non-local React mounting or subscription behavior. Do not activate automatically for documentation or skill-only changes, isolated tests or fixtures, copy/style-only edits, or mechanical local changes that do not affect those boundaries.
---

# Code Review

Use the project's Writing Great Code section as the design standard and [references/principles.md](references/principles.md) as the pattern catalog. This skill defines only the review procedure.

This skill owns semantic inspection, not task-wide validation. After it triggers,
choose the mode implied by the task:

- **Review-only:** inspect and report when the user asked for a review or audit.
  Do not edit unless the user also requested a change.
- **Implementation review:** inspect materially affected boundaries after an
  authorized implementation. Correct concrete in-scope findings and report the
  supporting evidence.

## Review workflow

1. Establish the review question and build the smallest review set that can
   answer it.
   - Start with files explicitly placed in scope; otherwise use the production
     modules changed by the current task and their focused tests. Never absorb
     unrelated dirty-worktree changes.
   - Include the nearest domain or boundary owner and direct consumers when the change affects a public contract, runtime validation, server access, cache behavior, or state transitions.
   - Include the nearest owner when a `key`, conditional, route, dialog, or pane controls its mounted identity.
   - Include direct consumers when a changed hook exposes values or functions, and include relevant Jotai atoms or React Query definitions when they own the state being consumed.
2. Inspect the review set.
   - Use the review map in [references/principles.md](references/principles.md), then read every section matching the code under review. Read the reference completely for broad audits.
   - Trace each affected behavior through its owner and consumers, including ingress validation, cache transitions, entity changes, mount and unmount, user actions, external updates, async completion, and cleanup where applicable.
   - Compare the behavior with focused tests and inspect committed behavior when checking a suspected regression.
   - Use existing Compiler, lint, type, and test diagnostics as evidence when
     relevant. Run a focused diagnostic only when it helps decide a suspected
     finding; a clean command is not a substitute for tracing behavior.
3. Keep only concrete findings.
   - Report behavioral risks and meaningful architectural or clarity problems,
     not cosmetic preferences or speculative redesigns.
   - In review-only mode, report findings in severity order with precise paths
     and supporting behavior. State explicitly when no findings remain.
   - In implementation-review mode, make the smallest behavior-preserving
     correction authorized by the task and validate the affected behavior with
     focused evidence.
4. Report findings, corrections, unresolved risks, and focused evidence.
