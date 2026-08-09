---
name: create-toy-box-app
description: Create, edit, install, uninstall, or repair Toy Box apps—saved React TSX surfaces that use the public app SDK to manage durable state, react to workspace state, open files, and launch ordinary sessions or app-owned workers. Use for any request to build, distribute, or revise a Toy Box app.
---

# Author Toy Box Apps

A Toy Box app is a reusable, single-file React component (`app.tsx`) that runs
inside the Toy Box app runtime. The runtime supplies a set of pre-installed
libraries, a basic design system for visual continuity, and an SDK for composing
workspace sessions, files, and panes.

Author definitions with ordinary filesystem tools, then use Toy Box's app tools
to activate definitions and manage instances. Do not inspect Toy Box source code
or its database to discover the app contract, and never edit SQLite directly.

## Mental Model

- A **definition** is trusted code, metadata, and one state contract stored on disk.
  Registering it validates and activates the current files. Revising it changes
  every instance that uses it.
- An **instance** is a saved, reopenable use of a definition with its own title
  and small durable JSON state. One definition may have many instances.
- A **share** is MIME-typed JSON content offered to another saved app. Definitions declare
  what they accept; pending shares survive while the receiving app is closed and
  do not execute until that app deliberately acts on them.
- The **design system** combines inherited theme tokens, scoped Tailwind, and
  provided components for common controls, feedback, model selection, and
  file and location selection.
- The **SDK** provides reactive app state and workspace data, the shared live-file
  lifecycle, and actions over sessions, files, and panes. Durable app state is
  shared across mounts and clients; interaction-only state stays local to the
  mounted component.
- Ordinary sessions are durable and user-visible. Workers are hidden sessions
  owned by a session, app, or file; their owner governs them independently of
  whether they are ephemeral.

## Definition Contract

An installed definition contains exactly two files:

```text
~/.toy-box/apps/<id>/
├── app.json
└── app.tsx
```

`app.json` contains:

```json
{
  "title": "App title",
  "description": "Optional concise description",
  "icon": "Feather",
  "color": "#8b5cf6",
  "accepts": ["x-session-launch"],
  "state": {
    "schema": {
      "type": "object",
      "properties": {
        "items": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["items"],
      "additionalProperties": false
    },
    "default": { "items": [] }
  }
}
```

Use a lowercase ID containing only letters, digits, and hyphens. `description`
and `icon` are optional. Supported icons are `Archive`, `ArrowLeft`,
`ArrowRight`, `Bot`, `Check`, `ChevronDown`, `ChevronLeft`, `ChevronRight`,
`Circle`, `CircleDot`, `Clock`, `Feather`, `File`, `FolderOpen`,
`GripVertical`, `Kanban`, `Loader2`, `MessageSquare`, `MoreHorizontal`,
`PanelTop`, `Pencil`, `Plus`, `Regex`, `Search`, `Settings`, `Sparkles`,
`Trash2`, and `X`. These exact names are also available as `lucide-react`
imports in `app.tsx`.

`color` is an optional six-digit hex color for new instances' Apps-panel icons
and defaults to neutral gray. `state.schema` is JSON Schema; omit the redundant
`$schema` property because Toy Box supplies the dialect. `state.default` must
satisfy that schema and seeds new instances without rewriting existing ones.
Both the schema and each state value must fit under 64 KiB.
`accepts` is optional. List the MIME types the app can interpret, such as
`"text/plain"`, `"text/markdown"`, or the Toy Box-specific
`"x-session-launch"`. Omit it when the app does not consume shared content.

## Author or Revise

1. Call `list_app_definitions` before choosing an ID. For a revision, read the
   existing `app.json` and `app.tsx`; use `list_apps` and `get_app` when
   instance state matters.
2. Before writing TSX, read
   [references/runtime.md](references/runtime.md) completely. It is the
   authoritative contract for available libraries, the design system, and the
   app SDK.
3. Design one coherent surface. Keep reopenable user data in app state and
   interaction-only state local to the mounted component. Choose how agent work
   should live:
   - Use `createSession` for durable, user-visible work that belongs in the
     session list.
   - Use `spawnWorker` for hidden implementation work whose result belongs in
     the app. It is ephemeral by default; retain it only for multi-turn work.
   - Use `useFile(...).spawnWorker` when the result belongs in a
     session file the app is presenting.
4. Create or patch only `app.json` and `app.tsx`. Preserve unrelated manifest
   values and behavior when revising a definition.
5. After all writes, call `register_app` with
   `{ "id": "<definition-id>" }`. Registration synchronously validates the
   manifest and state default, derives the TSX state type from the schema,
   typechecks and compiles the TSX, and returns the result:
   - On failure, read the source-positioned diagnostics, patch the files, and
     register again. The active revision remains unchanged.
   - On success, the new revision is active for every instance.
6. Call `create_app` only when the request needs a new saved instance; revising a
   definition already updates its existing instances. Use `update_app` only for
   an instance's title, icon color, or state. Deleting an instance cancels its
   app-owned worker sessions but does not delete ordinary sessions it created.
   Open and exercise the app when possible because successful registration proves
   compilation, not runtime behavior.

## Install or Uninstall

To install an existing app, call `install_app` with its public GitHub Gist URL.
The Gist must contain files named exactly `app.json` and `app.tsx`. An optional
`id` chooses the local definition ID; otherwise Toy Box derives one from the
manifest title. Installation validates and compiles the downloaded definition,
then creates its first saved instance. Treat Gist apps as trusted code because
they execute inside Toy Box.

To remove an installed definition, call `uninstall_app` with its ID.
Use `list_apps` and `delete_app` to remove every saved instance that uses it
first. Do not manually delete definition directories when these tools are
available.
