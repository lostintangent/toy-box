# Workers

Workers are anonymous, owner-bound collaborators backed by ordinary Sessions. They let a session
delegate work, a file run concurrent background edits, or an app run private implementation work
without introducing another execution model.

A Worker is not a persistent Agent: it has no portable identity, experiences, mention handle, or
cross-host membership. It is not an independent Session either: its owner controls its
capabilities, visibility, and teardown.

## Model

A Worker is one backing Session plus an immutable owner and lifetime. Both share one ID. An optional
name and metadata describe local work; they do not create an identity.

- A session-owned Worker inherits its parent's model and workspace context unless overridden. It is
  retained by default and opens as a linked child.
- A file-owned Worker belongs to one session file and is always ephemeral.
- An app-owned Worker belongs to one saved app, receives app-scoped tools, and is ephemeral by
  default.

`ephemeral` is the complete lifetime policy: delete after the current execution when true; retain for
follow-up until explicit or owner deletion when false. Worktree isolation is orthogonal. Sessions
owns the worktree; Worker lifetime decides whether its Session and worktree survive completion.

`model/` owns the Worker value, ownership helpers, and schemas for untrusted file and app commands.
`server/tools.ts` owns `spawn_worker`; the application session catalog only selects which roles
receive it. The tool injects its invoking session as a trusted owner.

## Algebra

Workers owns three operations:

- **Spawn** validates or injects the owner, publishes active work, and creates the backing Session.
- **Cancel** verifies external ownership, clears active work, rejects waiters, and stops startup or
  execution.
- **Delete** removes ephemeral work after completion and recursively removes work with its owner.

All ingress converges in `server/admission.ts`; `server/supervisor.ts` composes Session creation with
inheritance, worktree choice, cancellation guards, exact completion, and cleanup. The supervisor
persists Worker ownership before creating the backing Session; failed creation rolls it back through
the ordinary Session teardown path. Startup deletes ephemeral Workers abandoned by an earlier process.

Waiting remains a Session operation. Admission registers completion before publishing
`worker.started`, and the Session runtime retains the settlement briefly, so a fast ephemeral Worker
cannot disappear before `waitForSession` observes its result.

## Boundaries

`server/database.ts` persists ownership and lifetime for classification, deletion, and recovery.
`server/registry.ts` contains only active work and publishes `worker.started` and `worker.finished` to
the workspace stream. Workers has no query cache: the workspace snapshot is the client projection.
`components/WorkersMenu.tsx` owns activity, Session preview, and cancellation UI; Files and Apps only
select their owned Workers and mount it.

- Sessions owns execution, history, streaming, completion, and worktrees.
- The central Session projector translates `spawn_worker` completion into the generic linked-session
  event so live and replayed transcripts retain one interpretation path.
- Files and Apps initiate and present work but do not coordinate Worker lifecycle internals.
- Sessions and Apps request owner cleanup through Workers-owned operations.
- Agents owns persistent identity, experiences, and membership; neither feature wraps the other.
