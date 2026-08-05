# Toy Box App Runtime

The app runtime compiles and mounts `app.tsx`, which must default-export a React
component. It provides a deliberately small set of libraries, Toy Box's design
system, and the app SDK.

## Available Libraries

App modules may import from:

- `react` for component rendering, mount-local interaction state, and effects
  around external resources. Use `useState` for independent values and
  `useReducer` when several values form one transition model.
- `zod` for app-local parsing when a surface consumes untrusted text or external data.
- `@toy-box/sdk` for the design-system components and SDK hooks described below.
- `lucide-react` for the curated icons listed in `SKILL.md`.

Tailwind requires no import. Static utility classes in the TSX are compiled and
scoped to the app. Registration reports unsupported imports and TypeScript
errors with source-positioned diagnostics.

## Design System

### Theme and Tailwind

Apps inherit Toy Box's colors, typography, and light or dark appearance. Use
static Tailwind utility classes in `app.tsx`; Toy Box compiles and scopes them
under the app root. Keep each class complete in source instead of constructing
names such as `bg-${color}-500`.

`AppShell` is a CSS container, so use container variants such as `@md:` and
`@4xl:` for pane-responsive layouts rather than viewport variants such as `md:`
or `lg:`.

For CSS Tailwind cannot express, render a `<style>` element and scope every
selector beneath `[data-toybox-app='<definition-id>']`. Do not create stylesheet
sidecars.

### App Frame

- Use `AppShell` as the root. It applies host colors, scrolling, and the
  container-query boundary.
- Use `AppHeader` for top-level chrome. It reserves space for host pane actions;
  render visible titles, icons, and controls as children rather than using the
  native tooltip-only `title` attribute.

### Controls and Feedback

- `AppButton`, `AppInput`, `AppTextarea`, and `AppBadge` provide Toy Box's
  themed controls and variants. Prefer them when their semantics fit; use
  ordinary HTML for app-specific composition.
- `AppEmptyState` gives empty collections and initial screens consistent
  spacing, typography, and muted treatment. Pass `title`, optional
  `description`, and optional children for an action or illustration.
- `AppAlert` gives failures consistent alert semantics and destructive styling.
  Render the error as its children and use `className` only for surrounding
  layout.
- `AppSessionStatus` renders a session's standard Draft, Running, Idle, or
  Finished badge. Pass the reactive `session.status` value directly.
- `AppSessionToggle` renders the current surface's standard Open/Close control
  for a session. Pass its `sessionId`; the component subscribes to pane state
  and performs the toggle itself. Pass children only when a compact or
  app-specific button label is more useful than the standard control.

These components accept their corresponding native element props and
`className`.

### Pickers

- Use `AppModelPicker` when the user should choose the model for a new session
  or worker. It takes `{ value, onValueChange }`; initialize it from
  `workspace.defaultModel` and render it only when non-null.
- Use `AppLocationPicker` when work may run in a chosen directory or worktree.
  It takes `{ value, onValueChange, useWorktree?, onUseWorktreeChange? }`. Keep
  the directory value as `string | null` to match `onValueChange`.
- Use `AppFilePicker` when the user should choose or create a file on the host.
  It takes `{ value?, onValueChange, extensions?, className? }`, displays the selected file,
  and returns a machine `WorkspaceFile` that can be passed directly to the file
  and pane actions. Pass dot-prefixed `extensions` such as `[".md", ".mdx"]`
  to show and create only those file types. Use
  `type MachineFile = Extract<WorkspaceFile, { type: "machine" }>` when storing
  that narrower value.
- Use `AppSharePicker` to offer content to another saved app. Pass
  `{ mimeType, content, label?, className?, disabled? }`; it discovers compatible
  instances, performs the share, opens the receiver on the current surface, and
  shows `No supporting apps` when none accept that MIME type.

## SDK APIs

### Utilities

Use `createId()` for opaque IDs stored in app state. It uses browser randomness
that remains available when Toy Box is opened over an HTTP LAN origin, where
`crypto.randomUUID()` is unavailable.

### App Instance and Durable State

`useApp()` is the mounted app's primary API. It returns the current instance
metadata, pending shares addressed to it, manifest-validated durable state, its updater, and the host actions
described below. Use its state for JSON data that should survive closing the app
and stay synchronized across mounts and clients:

```tsx
const { id, title, state, shares, updateState, actions } = useApp();

await updateState((draft) => {
  draft.value = nextValue;
});
```

The app compiler specializes this parameterless hook from `app.json`, so `state`
and every draft are fully typed without a TS interface or local validator. When a
helper needs a named type, derive it instead of restating it:

```ts
type AppState = ReturnType<typeof useApp>["state"];
type Item = AppState["items"][number];
```

`updateState` supplies a private draft of the latest state. Mutate that draft and
return nothing; returning a complete replacement is also supported. Every completed
recipe is validated against the manifest schema before it appears optimistically or
reaches the server. The recipe may run again during conflict replay, so keep it
synchronous and derive the change only from its arguments and values captured before
the call. Keep schema revisions compatible with existing instances; use `get_app`
to inspect them before intentionally changing the state shape.

Interaction state that should reset with the mounted component belongs in React:

```ts
import { useReducer, useState } from "react";

const [query, setQuery] = useState("");
const [form, dispatch] = useReducer(formReducer, initialForm);
```

Use a reducer only when it makes coupled transitions clearer; do not wrap ordinary
fields in a reducer mechanically. A single `app.tsx` may define module-level child
components, and state can flow through props or React context when needed. Do not
create module-level mutable state, which would leak between app instances and
multiple mounts. Do not mirror app or workspace values into refs or effects;
reserve effects for external resources with explicit cleanup.

### Workspace State

Use `useWorkspace(selector)` for the smallest reactive workspace projection the
component needs:

```ts
type AppSession = {
  id: string;
  title: string;
  status: "draft" | "running" | "idle" | "unread";
  directory?: string;
  isRemote: boolean;
  worktree?: SessionWorktree;
  children: AppSession[];
};

type AppWorkspace = {
  sessions: AppSession[];
  apps: Array<{
    id: string;
    definitionId: string;
    title: string;
    revision: number;
    updatedAt: string;
    accepts: string[];
  }>;
  shares: AppShare[];
  models: Array<{
    id: string;
    name: string;
    supportedReasoningEfforts?: string[];
    defaultReasoningEffort?: string;
  }>;
  defaultModel: ModelConfiguration | null;
  openSessionIds: string[];
  openFiles: WorkspaceFile[];
  workers: Array<{
    sessionId: string;
    name?: string;
    metadata?: JSONType;
  }>;
};

const sessions = useWorkspace((workspace) => workspace.sessions);
```

Use this data to render live session status, durable child-session squads,
available models, saved apps, visible panes, and active app-owned workers.
`sessions` contains top-level standard sessions; each recursive `children` array
contains the session- and file-owned worker sessions rooted beneath it. `workers`
is already scoped to the current app instance; metadata should identify app-specific work, not repeat
ownership or carry prompts and results. Workers disappear when they finish, so
this collection is active execution rather than history.

`sessions` is the global summary catalog and may be large. Store session IDs in
app state instead of copying session records, resolve those IDs from this live
projection, and filter or cap interactive rows before rendering them. Scanning
the summaries is cheap; mounting hundreds of controls usually is not.

### Live Workspace Files

Use `useFile(file, mode)` when the app mounts a live file surface. It
is the same lifecycle used by Toy Box editor panes: it reads the initial file,
watches external changes, serializes and debounces saves, suppresses the watch
echo from its own writes, exposes file-owned workers, and flushes pending edits
before a worker starts or the surface unmounts.

```ts
type WorkspaceFileMode = "read" | "edit" | "shared";

type WorkspaceFileState = {
  content: string | null;
  revision: number;
  isReady: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save(content: string): void;
  flush(options?: { notifyAgent?: boolean }): Promise<void>;
  workers: Array<{
    sessionId: string;
    name?: string;
    metadata?: JSONType;
  }>;
  spawnWorker?(request: {
    name?: string;
    prompt: string;
    metadata?: JSONType;
  }): Promise<{ sessionId: string }>;
  cancelWorker(workerSessionId: string): Promise<void>;
};

const fileState = useFile(file, "edit");
```

`content` and `revision` are the latest external baseline; an editable renderer
owns its draft buffer and passes changes to `save`. Use `flush` only when an
operation must await pending writes. The hook uses `shared` mode to notify a
session file's owning agent after edits. The app must honor `read` mode in its
controls because modes are presentation policy, not a security boundary.

One mounted hook owns one stable file identity and one live watch connection.
When a picker changes the file, key a child file-surface component by the
file's identity so React remounts the complete lifecycle. Mount the hook for
active files, not for bulk file listings.

`spawnWorker` is available only for session files. It flushes pending edits and
starts an ephemeral, file-owned worker whose result belongs in that file. Its
pending workers appear in this hook's `workers` array and in any editor showing
the same file. Call `actions.waitForSession(worker.sessionId)` immediately
after spawning when the UI needs the final assistant response or completion
status. Ephemeral worker completion is not retained as history. Use
`actions.spawnWorker` instead when the result belongs in app state.

### Actions

The `actions` returned by `useApp` expose the host operations an app can perform:

```ts
type AppActions = {
  consumeShare(shareId: string): Promise<void>;
  createSession(input: SessionLaunch & { open?: boolean }): Promise<{ sessionId: string }>;
  spawnWorker(
    input: SessionLaunch & {
      name?: string;
      metadata?: JSONType;
      ephemeral?: boolean;
    },
  ): Promise<{ sessionId: string }>;
  waitForSession(sessionId: string, timeoutMs?: number): Promise<SessionCompletion>;
  cancelWorker(sessionId: string): Promise<boolean>;
  deleteSession(sessionId: string): Promise<void>;
  deliverMessage(sessionId: string, message: SessionMessage): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  openSession(sessionId: string): void;
  closeSession(sessionId: string): void;
  toggleSession(sessionId: string): void;
  openFile(file: WorkspaceFile, mode?: "read" | "edit" | "shared"): void;
  closeFile(file: WorkspaceFile): void;
  toggleFile(file: WorkspaceFile, mode?: "read" | "edit" | "shared"): void;
  readFile(file: WorkspaceFile): Promise<string>;
  writeFile(file: WorkspaceFile, content: string): Promise<void>;
};

type SessionMessage = {
  id?: string;
  content: string;
  attachments?: Array<{ displayName: string; mimeType: string; base64: string }>;
  model?: ModelConfiguration;
};

type SessionLaunch = {
  message: SessionMessage;
  directory?: string;
  useWorktree?: boolean;
};

type SessionCompletion = {
  status: "completed" | "failed" | "timed_out";
  response?: string;
};

type AppShare = {
  id: string;
  sourceAppId: string;
  targetAppId: string;
  mimeType: string;
  content: JSONType;
  createdAt: string;
};

type WorkspaceFile =
  { type: "session"; sessionId: string; path: string } | { type: "machine"; path: string };
```

#### App Shares

Use `AppSharePicker` for sharing. Give it a MIME type and any small JSON content;
the picker discovers compatible instances, persists the share, and opens the
receiver on the current workspace surface. Standard types such as `text/plain`,
`text/markdown`, and `text/uri-list` carry strings; custom types may carry any
agreed JSON shape. `x-session-launch` carries a `SessionLaunch`, but sharing it
does not create a session or execute the receiver.

Shares addressed to the mounted instance appear in `useApp().shares`, including
when they were created while the app was closed. Import a share into the app's
own state or workflow, then call `consumeShare` only after that acceptance is
durable. A receiver interprets and, when necessary, validates content according
to its MIME type; the share transport deliberately does not know payload schemas.

#### Sessions

Use `createSession` when the conversation itself is durable, user-visible
product data. Set `open: true` only when it should open immediately; otherwise
save the returned ID and let the user open or close its pane. Use
`deliverMessage`, `abortSession`, and `deleteSession` to manage a session the app
owns or explicitly presents. `waitForSession` observes a session's current
execution, whether it is an ordinary session or a worker. Its optional timeout
ends only the wait; use `abortSession` or `cancelWorker` when the app should stop
the underlying work.

#### App-Owned Workers

Use `spawnWorker` when an execution is an app-owned implementation detail. Workers
stay out of the session list and can update only their owning app. They are
ephemeral by default, so call `waitForSession` when the app needs their final
response or completion status. Set `ephemeral: false` only for a multi-turn
worker that must remain available after its initial execution; persist that
session ID in app state, use `deliverMessage` for follow-ups, and delete it when
it is no longer needed. The app deletes all of its workers when the instance is
deleted, regardless of their lifetime.

`workspace.workers` contains only currently queued or running workers. Use
`name` and JSON `metadata` for active-work UI and correlation. Persist only
durable worker IDs that the app must contact again. The collection is already
scoped to this app instance, so do not add app IDs or ownership filters.

App-owned workers execute independently. Let them run in parallel when their
tasks are independent; gate or batch them in app logic only when the product
workflow requires ordering. For serial work, await `waitForSession` before
spawning the next worker. Revision conflicts remain the state-write boundary.

Toy Box gives the worker owner-scoped tools to read the latest app state and
revision on demand, persist a complete next state, and recover from conflicts.
Describe the task and say whether its deliverable is a durable state
transformation or a final response; do not repeat the protocol or serialize
current state:

```tsx
const { actions } = useApp();
const defaultModel = useWorkspace((workspace) => workspace.defaultModel);
const workers = useWorkspace((workspace) => workspace.workers);

async function generate() {
  if (!defaultModel || workers.length > 0) return;
  await actions.spawnWorker({
    message: {
      model: defaultModel,
      content:
        'Generate the requested value, replace "generatedValue" in app state, and preserve every other field.',
    },
  });
}
```

#### Files and Panes

Use `readFile` and `writeFile` for one-off file operations. Use `useFile` when
the app presents a file continuously and needs live
updates, queued saves, modes, or file-owned workers. Use `AppFilePicker` instead
of asking the user to type an absolute host path when interactive selection
makes sense.

Use the open, close, and toggle actions to publish a session or file beside the
app. Publication belongs to the containing Main or Hyper surface, so app code
never chooses a host.

React Compiler runs during registration, so write render calculations and
handlers directly; do not add `memo`, `useMemo`, or `useCallback` solely for
render optimization. Keep render behavior deterministic, use stable keys and
accessible labels, and call mutations only from user actions.
