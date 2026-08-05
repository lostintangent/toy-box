# Toy Box Custom Editor Runtime

The custom editor runtime mounts the registered HTML in a sandboxed iframe and
injects one host API as `window.Toybox`. Use ordinary browser HTML, CSS, and
JavaScript; there is no package compiler or inherited Toy Box stylesheet.

## Document Contract

Provide a complete, standalone HTML document. Inline all CSS and JavaScript and
do not depend on local files, query parameters, file watchers, or fetching the
file. The host owns file access and supplies the current raw text through the
bridge.

Register the render callback from the document's script:

```js
window.Toybox.onRender((content, { revision, editable, pendingWorkers }) => {
  // Reconcile the complete UI with the latest inputs.
});
```

The callback runs immediately with the latest known values and again whenever
file content, revision, editability, or pending workers change. Parse
defensively and show useful empty or invalid states.

## Host API

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type PendingWorker = {
  sessionId: string;
  name?: string;
  metadata?: JsonValue;
};

type ToyboxEditorApi = {
  onRender(
    handler: (
      content: string,
      context: {
        revision: number;
        editable: boolean;
        pendingWorkers: PendingWorker[];
      },
    ) => void,
  ): void;

  emitChange(nextContent: string): void;

  spawnWorker(input: {
    prompt: string;
    name?: string;
    metadata?: JsonValue;
  }): Promise<{ sessionId: string }>;
};
```

### `onRender`

`revision` identifies the latest external file content. Replace the editor's
local buffer with `content` when this value changes. When the same revision is
delivered again, preserve the local buffer while reconciling `editable` and
`pendingWorkers`; do not append duplicate UI. Use `pendingWorkers` as the source
of truth for in-progress agent UI rather than keeping a separate durable worker
list.

### `emitChange`

Call `Toybox.emitChange(nextContent)` after an explicit edit, where
`nextContent` is the complete replacement file text. Only offer this behavior
when the latest render context has `editable: true`. Toy Box debounces and
persists the change. An own edit does not advance the external `revision` or
echo its content back through `onRender`, so update the local buffer and UI
before emitting it.

### `spawnWorker`

Call `await Toybox.spawnWorker({ prompt, name?, metadata? })` only from a direct
user action. The worker is owned by the current session file, stays out of the
ordinary session list, reads the latest saved content, and must persist its
result back into that file. Worker sessions are unavailable for machine files,
so catch failures and leave the editor usable.

Use `name` for understandable progress UI. Use small JSON `metadata` to identify
the target operation or placeholder; Toy Box returns it unchanged in
`pendingWorkers`. Because a worker can update the file before it finishes, suppress
a placeholder once the content proves its result is present even if the worker
remains pending.
