---
name: create-toy-box-editor
description: Create, revise, or repair Toy Box custom editors—reusable sandboxed HTML viewers that render and optionally edit files by extension and can launch file-owned worker sessions. Use for requests to customize how a file type appears or behaves in Toy Box.
---

# Author Toy Box Editors

A Toy Box custom editor is a reusable, self-contained HTML document that renders
files with one or more extensions inside a sandboxed iframe. The file remains
the durable source of truth. An editor may replace its complete content when
editable and may launch ephemeral worker sessions that update session files.

Use `register_editor` to save and activate the complete editor. Do not inspect
Toy Box source code to discover the contract; the runtime reference below is
authoritative.

## Mental Model

- One registered editor applies to every matching file across Toy Box.
- The host sends raw file text, editability, and pending file-owned workers
  through `window.Toybox`; the iframe never reads or watches the file itself.
- The editor owns presentation and interaction state. Durable changes replace
  the file content through the bridge.
- Built-in editors take priority when extensions overlap. Unclaimed extensions
  otherwise use Toy Box's default editor.

## Author or Revise

1. Inspect representative files and understand the format, invalid states, and
   useful interactions. When revising an editor, read its current
   `~/.toy-box/editors/<name>/editor.json` and `index.html`, but do not modify
   those files directly; registration is the writer and activation boundary.
2. Read [references/runtime.md](references/runtime.md) completely before
   authoring the HTML.
3. Build one complete HTML document with all CSS and JavaScript inline. Make
   rendering idempotent, tolerate malformed or empty content, and replace the
   local editing buffer only when the host revision changes.
4. If editable, emit the complete next file text only from explicit user edits.
   If agent assistance is useful, launch a worker only from a direct user action
   and derive pending UI from the workers supplied on every render.
5. Pass the HTML directly to `register_editor`; do not create a separate HTML
   session artifact. Call it with the complete definition:

   ```json
   {
     "name": "csv-table",
     "extensions": ["csv"],
     "icon": "table",
     "editable": true,
     "html": "<!doctype html>..."
   }
   ```

   Use a lowercase name containing only letters, digits, and hyphens.
   Extensions may include a leading dot but are stored lowercase without it.
   Supported icons are `braces`, `json`, `code`, `table`, `list`, `database`,
   `image`, `chart`, `text`, and `file`. Re-registering the same name replaces
   its definition.

6. Open representative files and exercise initial rendering, external content
   updates, edits, malformed input, and worker behavior as applicable. Create
   worker-enabled examples in this session's files folder and use their artifact
   panes; opening the same path as a machine file creates a second address that
   cannot own workers. Validate through Toy Box rather than installing a
   separate browser harness.
