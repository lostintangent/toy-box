---
name: run-squad
description: Coordinate substantial repository work through one durable leader and focused child sessions with isolated implementation, independent review, repair loops, and optional user approval. Use when the user asks to run or launch a squad or swarm, delegate work across multiple agents, or apply an implementation-and-review workflow. In Hyper, launch a standard leader session; in a standard session, lead the squad directly.
---

# Run a Squad

Use Toy Box sessions as the orchestration runtime. One standard session owns the
run, and its durable child sessions own distinct assignments. Do not create an
app, a second state ledger, or coordination files merely to track the run.

## Enter the Run

Choose the path from the tools available to the current session:

- If `create_session` is available, this is Hyper. Create one independent
  standard session with `open: true`, the user's effective directory, and an
  initial prompt that explicitly invokes `/run-squad` with the user's complete
  objective and constraints. Do not put the leader in a worktree. Report the
  created session and stop; the new session owns the run.
- If `open_session` is available but `create_session` is not, this standard
  session is the leader. Continue with the workflow below.
- Otherwise, do not start a nested squad. Explain that the skill must be invoked
  from Hyper or a standard session.

For repository work, require a meaningful working directory before Hyper
launches the leader. Passing the same directory also lets the new session
rediscover project-owned skills and instructions.

## Shape the Squad

Use the smallest set of roles that creates genuinely independent responsibility.
For an ordinary code change, start with exactly:

1. One implementer that owns the change and its focused validation.
2. One fresh reviewer that cannot edit and judges the resulting commit.

Add a researcher, specifier, tester, or another implementer only when the task
contains a separable question, artifact, or change. Never create workers merely
to simulate activity. Prefer one active writer; parallel writers require
independent commits and an explicit integration order.

Honor roles and workflow constraints supplied by the user or repository. Treat
those instructions as the definition for this run rather than inventing a
persistent squad schema.

## Lead the Work

1. Inspect the repository instructions, current status, and relevant code. State
   concrete completion evidence and record the destination HEAD and status before
   delegating. The leader coordinates, integrates, and verifies; it does not
   duplicate an implementer's assignment.
2. Create durable children with `create_worker_session`. For a writing assignment
   in a Git repository, use the repository directory and `useWorktree: true` by
   default. Pass the destination only as the tool's `directory`; do not repeat
   that path inside the assignment. Tell the writer to edit and commit only in
   its session's current working directory, which Toy Box relocates to the new
   worktree. Give every durable child a concise role-based `name`, such as
   `Implementer` or `Reviewer 1`. Give every worker one bounded responsibility,
   the complete relevant constraints, and an explicit result contract.
3. Require an implementer to preserve unrelated work, run focused checks, and
   create one self-contained commit. Its final response must end with:

   ```text
   SQUAD_IMPLEMENTATION: {"status":"completed|blocked","summary":"...","commit":"full SHA or empty"}
   ```

4. Wait for the exact child with `wait_for_sessions`. Treat a timeout, missing
   marker, invalid payload, failed validation, missing required commit, or a
   changed destination HEAD or status as incomplete rather than inferring
   success. If a requested worktree did not isolate the write, stop instead of
   reviewing or integrating it.
5. After implementation completes, create a fresh durable reviewer. Tell it not
   to edit. Give it the objective, acceptance evidence, repository directory,
   and full commit SHA. Have it inspect that commit and surrounding code without
   checking out the writer's branch, run focused validation, and end with:

   ```text
   SQUAD_REVIEW: {"verdict":"accepted|changes-requested","summary":"...","feedback":"..."}
   ```

6. If review requests changes, send one consolidated repair request to the same
   implementer with `deliver_message`. Require it to amend its commit so the next
   reported SHA represents the complete change. Wait for it, then use a fresh
   reviewer. Stop after two repair rounds unless the user explicitly asks to
   continue.
7. Once review accepts, present the objective, implementation summary, review
   evidence, validation, and commit. Unless the user explicitly requested
   autonomous integration, ask whether to apply it and end the turn.
8. On approval, verify the destination working tree is safe, cherry-pick the
   accepted commit, and run the relevant validation in the destination. Never
   reset, stash, discard, or overwrite unrelated work. If the work was performed
   without a worktree, verify the existing result instead of cherry-picking it.
9. On rejection, send the user's consolidated feedback to the same implementer
   and repeat independent review. Do not apply rejected work.

Keep durable child sessions available as the observable record unless the user
asks to remove them.

## Recover Safely

The leader session transcript and its tool results are the durable record. On a
later turn or after reconnecting:

1. Recover child session IDs, reported commits, and the last accepted decision
   from the transcript.
2. Use `check_session_status` and `wait_for_sessions` before replacing a child
   that may still be running.
3. Resume the same implementer with `deliver_message` for repairs or clarification.
4. Create a new reviewer for every independent review pass.

Never invent completion from stale prose, launch a duplicate assignment because
a wait timed out, or claim integration before destination validation succeeds.
