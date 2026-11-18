# Design calibration

Cases from this codebase's history. Each pairs a signal with the smaller design that replaced it and the rule it calibrates. The final section records complexity that was justified; read it before recommending a removal.

## Scope beyond the baseline

- **An unrequested guarantee.** The contentEditable composer made host writes (voice dictation, restoring a queued message, channel replies and mentions) preserve native undo, which the textarea it replaced never did. Upholding that guarantee took `replace(): Promise<boolean>`, a pending-edit union, a recovery module and notice, a serial task queue, and a 611-line browser script. Writing the draft string directly, as the textarea had, removed 428 lines. Question the guarantee before perfecting its machinery.
- **Enhancements inside a reduction pass.** A minimalism pass on the composer also added completion-feedback states and an exhaustive `Omit<…>` prop blacklist, and both were reverted. A reduction pass only removes; propose enhancements separately.
- **Compatibility with nothing.** A migration that renamed the unshipped Minecraft client's save folder and in-code backfills for unshipped channel columns were removed, and file references shipped without a parser for the old `@path` syntax. Unshipped code has no users to migrate; migrate local data by hand.
- **Defensive handling.** Session and file completion searches gained failure states even though those queries can't fail unless the whole app has. `useCurrentSession` rebuilt its result (`{ ...session, sessionId: session.sessionId }`) only to narrow a type. Neither served a requirement.
- **Cost on the default path.** Child-session rows in the sidebar mount nothing until their parent expands, so sessions without expanded children pay nothing for the feature.

## Shape

- **Dispatch spread across a host.** `PromptCompletions` branched on source type for fetching, filtering, pending state, encoding, and empty text, so each new source meant editing every branch. Declarative sources (`trigger`, `query`, `kind`) moved that work into the shared completion hook, and the host shrank from 265 lines to 100. A new source should be one declaration.
- **A synthetic event.** Loading older channel history went through the reducer as a `history` event, though a page of already-reduced messages records no transition. Pages now merge directly, and reducer events stay domain transitions.
- **One rule in many places.** Channel attention (a pending request, an unread completion) was derived in SQL, in the reducer, and in request helpers. Recording `requestSequence` and `completedSequence` gave the rule one owner, and clients derive the flags from them.
- **Derived data stored as data.** An attachment's `name` was always the filename in its URL, so the gallery can derive it. A message's audience follows from its content, so it isn't stored. Toy Box likewise doesn't mirror provider metadata in its database or read transcripts to fill list views; when a provider can't supply something cheaply, show nothing.
- **Duplicate authority.** A second column recording who may direct a task's agent duplicated the task's owner. Keep one authority per fact.
- **Pass-through machinery.** A mutation hook that wrapped another mutation's `mutateAsync` gave one request two lifecycles. Prop chains carrying the working directory and skill catalog through the composer disappeared once completion sources read session context and queried their own catalog.
- **A smaller count, a weaker boundary.** An audit removed seven Workers verbs (`listWorkers`, `getWorker`, `updateWorker`, and others) as pass-throughs to `WorkerDatabase`, so Inbox and `managedSessions` built Workers' storage class themselves. The count fell, but Inbox no longer asked Workers for what it meant, and the verbs came back. A verb in a subsystem's contract is a boundary even when it only delegates. Only an internal pass-through is noise.

## Names

- The channel reducer's output was named `ChannelSnapshot`, but Sessions calls the equivalent `SessionState`: a snapshot is a role (state at one point in time), not a type. For the same reason `observeChannel` in `snapshots.ts` became `streamChannel` in `stream.ts`, and `markRead` became `mode: "passive"`.
- `ChannelListEntry` named a hook result that isn't a model type, so the result is inferred instead.
- The Minecraft client's "studio" and "workshop" packages became `screens` and `world`. Literal names beat themed ones.
- A field belongs on a shared type when every instance of the concept has it, not only when shared code reads it. `label` was wrongly removed from the base completion item because the shared menu never read it, although every host set it.

## Precedent and platform

- File completions flickered while searching, though the file browser already kept previous results visible, and unselectable, with `keepPreviousData`.
- The session picker reuses the sidebar's existing rule for ordinary top-level sessions instead of defining its own filter.
- Composer browser tests ran on Vitest and Vite in a repository that tests with Bun; `Bun.WebView` and Bun's HTML imports replaced both.
- The Markdown editor needed no DOM workaround to read `light-dark()` theme colors once the colors were registered with `@property`, which lets the browser resolve them.
- Loading states render the real component without data, such as a task card with a null ID, rather than a lookalike skeleton.

## Tests

- A 35-line fix to a task-creation handoff arrived with a 303-line integration file; two focused cases in the existing harness covered the contract.
- A cleanup pass added tests asserting that removed code was gone. Such tests protect nothing.
- Sidebar tests that only asserted rendered markup were deleted, and the ownership tests stayed.

## Justified complexity

- The composer keeps its IME composition guard, a Safari caret fix after non-editable pills, and a reentrancy guard for native insertion. Each traces to a reproduced platform failure.
- A completion item's `detail` (muted text beside the label: where it is) and `description` (a second line: what it does) look alike but mean different things. Merging them moved file paths to a second line, which the user rejected.
- Channel task diffs roll up to parent tasks, but artifacts don't, because the overview already lists them. The mechanics are shared; the meanings differ.
- Spawning a worker no longer opens its pane, but an explicit `open_session` still does. Creating and opening are different verbs.
- A task-ownership handoff keeps its session retirement and fencing. An idle check alone can't safely revoke an old conversation.
