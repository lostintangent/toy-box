---
name: review
description: Review Toy Box changes and subsystems for design quality (the smallest necessary machinery, clear ownership, a coherent ontology) and for concrete lifecycle and state risks, against its design standards and React, TanStack, Jotai, and Zod patterns. Use when the user asks for a review, audit, deep look, or end-to-end trace; a minimalism, redundant-machinery, or brutal pass; an elegance, ownership, naming, or nouns-and-verbs assessment such as "10 stars"; or a response to another agent's review. Also use before reporting an implementation that materially changes a domain or public contract, runtime schema, session/stream/request lifecycle, persistence or concurrency behavior, cache/query semantics, shared state ownership, or non-local React mounting or subscription behavior. Do not activate automatically for documentation or skill-only changes, isolated tests or fixtures, copy/style-only edits, or mechanical local changes that do not affect those boundaries.
---

# Review

The design standard is the "Writing Great Code" section of the root AGENTS.md. [references/principles.md](references/principles.md) catalogs React, TanStack Query, Jotai, and Zod patterns, and [references/design.md](references/design.md) calibrates design judgment with cases from this codebase, including cases where complexity was justified. This skill defines the review procedure.

## Lens and authority

Choose the lens from the request:

- **Design:** the default for requests about minimalism, redundant machinery, elegance, ownership, naming, ontology, or "10 stars". Establish whether each concept, state value, abstraction, test, and workflow must exist for the agreed behavior. It is not a bug hunt: skip edge cases and defensive hardening, and raise a correctness defect only when it exposes a structural flaw; otherwise note it in one line.
- **Risk:** when the user asks for bugs, risks, or an audit. Trace behavior for stale state, races, leaks, and broken transitions.

When a request names neither, apply both, design first. Reviewing your own material implementation before reporting it also applies both.

Choose the authority from the request:

- **Review-only:** report findings; edit only when the user also asked for changes.
- **Implementation review:** correct concrete in-scope findings in your own change, then report.

Do design reviews and reduction passes yourself rather than delegating them to subagents.

## 1. Establish the baseline and review set

- The baseline is the committed behavior plus what the user explicitly asked for; when the work followed a plan (see the `plan` skill), the plan's outcome and decisions define it. Anything beyond the baseline is scope that must justify itself, not machinery to perfect: an added guarantee, fallback, failure path, setting, or UX, or compatibility and migration code for something that hasn't shipped (migrate local data by hand instead).
- Start with the files placed in scope; otherwise use the production modules the change touches and their focused tests. Never absorb unrelated worktree changes; other sessions may be editing the same tree.
- Include the nearest domain or boundary owner and direct consumers when the change affects a public contract, runtime validation, server access, cache behavior, or state transitions; the owner of any `key`, conditional, route, dialog, or pane that controls mounted identity; and the Jotai atoms or React Query definitions behind a changed hook's values.

## 2. Sketch the smallest design before reading closely

Reading the implementation first anchors you to its choices. When the work followed a plan, the plan is your sketch. Otherwise, as with another agent's change or an inherited diff, sketch the smallest design that delivers the baseline before tracing the code line by line: its public API, nouns and verbs, owners, and state. Look for precedent while sketching:

- an existing mechanism, selector, component, or visual primitive that already plays the role;
- the name the codebase already uses for the role, with Sessions as the reference vocabulary (state, reducer, stream, passive and active);
- what the platform or stack already provides, such as CSS, the DOM, Bun, TanStack, and Tailwind.

Then read the change against the sketch, starting with `bun run domain diff` for its size, contracts, nouns, and verbs. Each place where it exceeds the sketch, such as a concept, guarantee, file group, or size the plan didn't include, is a candidate; where it meets a requirement the sketch missed, fix the sketch instead. A plan isn't exempt from review: when a probe below shows it chose poorly, say what should change.

## 3. Probe each candidate

- **Premise:** when machinery exists to uphold a guarantee, question the guarantee before improving the machinery.
- **Necessity:** name the behavior it buys and what it obligates: state, branches, effects, tests, and docs. It stays when it serves the baseline or a demonstrated platform failure.
- **Independence:** for each stored, cached, or passed value, ask whether any real producer can vary it independently. If none can, derive it where it is used; two values that always agree are one fact.
- **Extension:** add the next representative instance on paper, such as another completion source, client, view, or kind. If it must touch more than its own declaration, ownership is leaking.
- **Contract:** a subsystem's contract with other subsystems, which the diff lists under Contracts, is a boundary like a server function or HTTP route, so judge it as one: consumers should use it for what they mean. Removing a contract verb by having consumers reach into the storage or mechanics it hid weakens the boundary, however much it shrinks the count. Internal nouns and verbs are the ones to minimize.
- **Naming:** each new type, module, prop, and event should name a domain concept or a role the codebase already names. A function that only builds a noun is its constructor, named after it, like `channelLead`, not a new verb. Prefer inferred types to named ones that aren't model concepts, and literal names to themed ones.
- **Defensiveness:** handling for failures that cannot occur, or that would mean the app is already broken, has no requirement behind it.

Keep distinct meanings distinct: share mechanics without merging concepts that merely look alike. Reject a candidate that trades one mechanism for another of similar size. Finding nothing is a valid outcome; don't manufacture findings.

## 4. Trace risks and patterns

- Use the review map in [references/principles.md](references/principles.md) and read every section matching the code under review; read the whole catalog for broad audits.
- Trace each affected behavior through its owner and consumers: ingress validation, cache transitions, entity changes, mount and unmount, user actions, external updates, async completion, and cleanup.
- Compare behavior with focused tests, and with committed behavior when checking a suspected regression. Compiler, lint, type, and test diagnostics are evidence, but a clean command doesn't substitute for tracing behavior.
- When a change extends a mechanism to new consumers, verify that the original consumer still works.

## 5. Hold tests to their contract

- A behavior-preserving removal or refactor needs no new test. Never add a test that only proves deleted code is gone.
- When the work followed a plan, start from the contracts its validation named.
- Add a test only for a surviving contract that no existing test protects, at the lowest layer that can prove it: exhaustive tests for pure models and reducers, and thin integration tests only for what those can't prove, such as transactions, ordering, replay, and cancellation.
- A test earns its place when a meaningful defect would fail it and a harmless refactor would not. Assertions on CSS classes, markup structure, library behavior, or rules a lower layer already proves are findings.
- When a refactor breaks a test that only pins implementation detail, delete the test instead of repairing it.

## 6. Triage another review

When the user relays another agent's findings, or asks you to look again after someone else changed the code:

1. Verify each claim against the current code; reviews go stale and overreach.
2. Classify each item as a simplification that removes machinery and preserves behavior; a behavior or UX change, which is the user's decision; scope expansion or defensive hardening, which you decline unless requested; or something already decided in this conversation, which you don't reopen without new requirements or evidence.
3. Recommend the narrowed set, and say briefly why the rest doesn't qualify.

## 7. Report

- Lead with your recommendation, then findings in order of leverage. For each finding, state what disappears or changes and why the agreed behavior survives. Present a needed behavior change as the user's decision.
- Don't call a design minimal, finished, or "10 stars" by assertion. Name the criterion it meets, such as the extension probe passing, and list the candidates you rejected with one reason each. When asked for a rating, answer with the concrete remaining gaps.
- When you changed code, end with one line of net lines from `bun run domain diff`, split into production, tests, and docs; when a plan set a footprint, compare against it. A reduction that comes out net-positive needs a reason for each growing file, or another pass.
- When the change creates or reshapes domain concepts, close with its nouns, verbs, and owners in a few lines.
- Say explicitly when no findings remain.
