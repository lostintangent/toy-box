---
name: plan
description: Plan a Toy Box change before building it, so the work starts from the right outcome, the existing design, and the smallest shape that fits, with explicit expectations that review and dogfood can check. Use when the user asks for a plan, proposal, or approach, or asks whether or how something could be done ("can we", "how would we", "what would it take", "thoughts?", "think this through"); and before implementing a change that adds or reshapes a domain concept, public contract, schema or wire format, agent tool or instructions, stream or lifecycle, persistence, cache semantics, or shared UI primitive. Skip small local edits, copy or style tweaks, and documentation-only changes.
---

# Plan

A plan decides what to build while changing course is still cheap. It is half of a pair: the plan sets expectations before the code exists, and the `review` skill holds the finished work to them, so review confirms a sound design instead of repairing a weak one. The values both apply are the "Writing Great Code" section of the root AGENTS.md; this skill is how to apply them when designing a change.

A plan is good when it gets these right, in priority order:

1. **The outcome.** What the user asked for, stated as observable behavior, and nothing they didn't.
2. **Fit.** The change extends the system's existing concepts, owners, and primitives instead of building a parallel version of them.
3. **Economy.** It is the smallest coherent change that delivers the outcome, and every concept it adds is one the outcome requires.
4. **Learning early.** The assumption most likely to be wrong is tested before the work depends on it.
5. **Checkability.** Its behavior, decisions, size, and validation are explicit enough for review and dogfood to verify.

## Working with the user

- A request for a plan, a feasibility check, or your thoughts gets a plan; building starts when the user asks for it. When the user asks you to build, plan in proportion to the change, then build without pausing for routine approvals.
- Treat a solution the user proposes as a hypothesis: weigh it against the alternatives, and say plainly when another design is better.
- Bring the user only genuine product and taste decisions, each with your recommendation.

## 1. Understand the outcome

Describe the change as behavior: what the user, other clients, and agents will see or be able to do. Identify who acts and with whose authority, especially when a capability lets one person or agent spend another's resources or act on their behalf. Name what must keep working, including every other consumer of what the change touches. List what you're deliberately not doing, such as new guarantees, fallbacks, settings, or generalizations, so that adding any of them becomes a decision rather than drift.

## 2. Understand the system

Trace how the behavior works today, end to end, and ground every claim in code you've read. Then search for what already exists before designing anything: the feature that owns this behavior, shared modules and components, sibling features that solved a similar problem, and the installed libraries and platform. Read their current APIs and docs rather than relying on memory, since what you need may have shipped recently. Find where the data lives, and build on that source of truth instead of copying it.

## 3. Choose the shape

Start with the cheapest options and move up only for a reason: it already works or needs only configuration; then a change to an existing owner; then an extension of an existing concept; then a new concept. Sketch two or three candidate shapes and choose the one with the fewest new concepts and the clearest ownership.

- Reuse what step 2 found, and say what you're reusing. Each new noun or verb (a type, field, event, module, agent tool, or UI component) needs a reason no existing one can carry it. Name new ones in the codebase's existing vocabulary.
- Keep one authority per fact, and derive whatever can be derived. A cache or stored copy is a second authority to keep in sync: when the source can't serve a view cheaply, first consider narrowing the view, and present a cache to the user as a decision, with its cost.
- Design for the requirements and failure modes that exist. Leave out speculative generality and handling for failures that can't happen.
- Settle the hard-to-reverse parts now: the data model, schemas and wire formats, public contracts, and agent-facing tools and instructions. Choose them on their merits rather than to avoid a migration. Change unreleased shapes in place and migrate local data by hand. To change a released table, append a version to its feature's schema (see `src/server/database.ts`). Never add compatibility code that reads old shapes.
- Say how the change reaches every client observing the state, and what the default path costs while the feature isn't in use.
- Test the shape by adding the next instance of the pattern on paper: it should touch only its own declaration.

## 4. Retire the biggest risk

Name the assumption most likely to invalidate the plan, such as a platform or library capability, a performance limit, or how an interaction will feel. When a cheap experiment can settle it, such as a scratch script, a throwaway prototype, or side-by-side variants, run it before committing and report the result. Otherwise, make verifying it the first step of the work.

## 5. Set expectations

- **Footprint:** the files or modules touched, every new concept, and rough production and test lines. When the estimate is large for the outcome it buys, look for a smaller shape or split the work.
- **Validation:** the contracts worth testing and at which layer (exhaustive tests for pure models and reducers, thin integration tests only for what those can't prove), and the dogfood scenarios that exercise the change, including existing consumers of anything shared. A behavior-preserving refactor needs no new tests.
- **Sequence:** behavior-preserving refactors land before the feature, and enhancements stay out of cleanups. Each step leaves the product working.

## Present the plan

Lead with the recommendation, then include only what applies: the outcome (what changes, what stays the same, what you're not doing), the shape (what it reuses, and each new concept with its reason), the risk and what any probe showed, the footprint, validation, the sequence, and decisions for the user. Size the plan to the change; a small change needs a few lines. Keep the plan in the conversation. Write a brief only when the user asks or the work spans sessions or agents, following the `create-toy-box-brief` skill.

## Build to the plan

The plan is the contract. When the work needs something the plan didn't include, such as a new concept, guarantee, or group of files, or grows well past its footprint, stop and decide which is wrong: if the plan missed something, update it and tell the user in a line; if the work is drifting, cut it back. Check in with the user only when the change would alter agreed behavior or scope. When you finish, report the actual footprint against the plan.
