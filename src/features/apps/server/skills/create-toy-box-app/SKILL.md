---
name: create-toy-box-app
description: Create, edit, promote, install, uninstall, or repair Toy Box apps—session-scoped .toy artifact apps and installed React TSX surfaces that use the public app SDK to compose workspace sessions, files, and panes. Use for requests to build or change an artifact app, session app, or installed Toy Box app.
---

# Author Toy Box Apps

A Toy Box app is a single-file React component that runs inside the Toy Box app
runtime. The runtime supplies pre-installed libraries, a design system for visual
continuity, and an SDK for composing workspace sessions, files, and panes. It has
two storage and ownership models:

- **Artifact apps** are `*.toy` files in the current session's artifacts folder.
  Each file is session-owned and has no manifest, registration, saved instance,
  durable app state, pending shares, or app-owned workers.
- An **installed definition** is a reusable `app.tsx` plus `app.json` under
  `~/.toy-box/apps/`. Each saved instance has its own durable state and global
  workspace identity.

Use ordinary filesystem tools to author either kind. These app files are
authored extensions, not Toy Box repository changes. Do not invoke repository
code-review skills or run repository build, lint, typecheck, or test commands.
Artifact validation and installed-app registration are the complete
code-quality gates.
Do not inspect Toy Box source code or its database to discover the app contract,
and never edit SQLite directly.

Before writing TSX for either kind, read
[references/runtime.md](references/runtime.md) completely. It is the
authoritative contract for available libraries, the design system, and the app
SDK.

## Mental Model

- A **share** is MIME-typed JSON content any app surface can offer to a saved app.
  Definitions declare what they accept; pending shares survive while the receiving
  app is closed and do not execute until that app deliberately acts on them.
- The **SDK** is the app's boundary to Toy Box-owned workspace state, files,
  sessions, workers, panes, shares, and saved app state. It does not replace
  standard browser APIs. Available SDK capabilities depend on the app kind.
- Ordinary sessions are durable and user-visible. Workers are hidden sessions
  owned by a session, app, or file; their owner governs them independently of
  whether they are ephemeral.

## Choose the App Kind

Create an artifact app when the user asks for an artifact, session app,
session-local app, stateless app, or a visual interactive result that belongs to
this conversation. Create an installed app when the user asks for a reusable,
global, bookmarked, distributable, or durably stateful app. If that distinction
would materially change the result and the request does not establish it, ask.
Installed app work requires `register_app`; if that tool is unavailable, do not
leave a partially written definition.

Never register a `.toy` file or create a JSON sidecar for it. Never represent an
artifact app as an app instance. Multiple artifact apps are simply multiple
uniquely named `.toy` files in the same session.

## Author or Revise an Artifact App

1. Choose a concise relative path ending in `.toy`, then create or patch that
   file inside the current session's artifacts folder from the system instructions.
   For a revision, read and preserve unrelated behavior in the existing file.
2. Build one coherent surface. Keep interaction state local and use only the
   portable capabilities described by the runtime reference. Artifact apps have
   no saved instance, durable app state, received shares, or app-owned workers.
3. After every complete write, call `validate_artifact_app` with the path
   relative to the session artifacts folder:

   ```json
   { "path": "release-board.toy" }
   ```

   Validation reads the current file, derives stateless SDK types, typechecks,
   and compiles it without registering or saving anything. On failure, patch the
   source-positioned diagnostics and validate again. On success, use the returned
   preview URL for hands-on QA.

4. Toy Box surfaces session artifacts automatically. Never call `open_file` for
   a `.toy` file; that tool is only for machine files and would create a second,
   non-executing pane for the same path. Exercise the artifact only when browser
   controls are actually available because successful validation proves
   compilation, not runtime behavior.

## Installed Definition Contract

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
and `icon` are optional. Choose an icon from the curated names in the runtime
reference.

`color` is an optional six-digit hex color for new instances' Apps-panel icons
and defaults to neutral gray. `state.schema` is JSON Schema; omit the redundant
`$schema` property because Toy Box supplies the dialect. `state.default` must
satisfy that schema and seeds new instances without rewriting existing ones.
Both the schema and each state value must fit under 64 KiB.
`accepts` is optional. List the MIME types the app can interpret, such as
`"text/plain"`, `"text/markdown"`, or the Toy Box-specific
`"x-session-launch"`. Omit it when the app does not consume shared content.

## Author or Revise an Installed App

1. Call `list_app_definitions` before choosing an ID. For a revision, read the
   existing `app.json` and `app.tsx`; use `list_apps` and `get_app` when
   instance state matters.
2. Design one coherent surface. Keep reopenable user data in app state and
   interaction-only state local to the mounted component. Use the runtime
   ownership guidance to choose durable sessions, app-owned workers, or
   file-owned workers.
3. Create or patch only `app.json` and `app.tsx`. Preserve unrelated manifest
   values and behavior when revising a definition.
4. After all writes, call `register_app` with
   `{ "id": "<definition-id>" }`. Registration synchronously validates the
   manifest and state default, derives the TSX state type from the schema,
   typechecks and compiles the TSX, and returns the result:
   - On failure, read the source-positioned diagnostics, patch the files, and
     register again. The active revision remains unchanged.
   - On success, the new revision is active for every instance.
5. Call `create_app` only when the request needs a new saved instance; revising a
   definition already updates its existing instances. Use `update_app` only for
   an instance's title, icon color, or state. Deleting an instance cancels its
   app-owned worker sessions but does not delete ordinary sessions it created.
   Use the `previewUrl` returned by `create_app` or `get_app` to open and exercise
   the app when possible because successful registration proves compilation, not
   runtime behavior.

## Promote an Artifact App

Promotion copies an existing session artifact into the installed-app lifecycle;
it does not mutate the artifact into a new pane or record.

1. Promotion requires the installed-app lifecycle tools.
2. Read the selected `.toy` file and call `list_app_definitions` before choosing
   a lowercase definition ID.
3. Copy the source unchanged to `~/.toy-box/apps/<id>/app.tsx` unless the user
   explicitly asks to add durable behavior.
4. Create `~/.toy-box/apps/<id>/app.json`. A direct stateless promotion uses:

   ```json
   {
     "title": "App title",
     "icon": "Feather",
     "color": "#8b5cf6",
     "state": {
       "schema": { "type": "null" },
       "default": null
     }
   }
   ```

   Add optional metadata only when it is meaningful. If the user requests
   durable app data, design a real state schema and adapt the TSX to `useApp`
   instead of treating the promotion as a source-only copy.

5. Call `register_app`, repair any diagnostics, and retry until registration
   succeeds.
6. Call `create_app` only when the user also wants a saved instance. Keep the
   original `.toy` artifact unless the user explicitly asks to remove it.

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
