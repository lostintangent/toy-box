# React review signals

Use this catalog to interpret code and compiler or lint signals during a React review. Each pattern is a signal to investigate, not a finding by itself. Choose a correction only after confirming the intended ownership, lifetime, and behavior through call sites and tests.

## Review map

1. [Mounted identity](#1-match-mounted-identity-to-domain-identity)
2. [State ownership](#2-give-editable-state-one-owner)
3. [Independent state](#3-store-only-independent-state)
4. [Transitions and effects](#4-keep-transitions-explicit-and-effects-external)
5. [Resource lifetimes](#5-model-resource-lifetimes-directly)
6. [React Compiler](#6-let-react-compiler-own-render-memoization)
7. [Component types](#7-keep-component-types-stable)
8. [Jotai subscriptions](#8-subscribe-at-the-semantic-consumption-boundary)
9. [React Query](#9-keep-server-state-in-react-query)

## 1. Match mounted identity to domain identity

**Look for:** reset effects keyed to an ID, multiple children resetting for the same ID change, or local state surviving when the parent swaps entities.

**Correct by:** keying the nearest owner when the local state belongs to one entity. This makes React perform one complete teardown and initialization.

Avoid:

```tsx
function DocumentEditor({ document }: { document: Document }) {
  const [draft, setDraft] = useState(document.text);

  useEffect(() => {
    setDraft(document.text);
  }, [document.id, document.text]);

  return <Editor value={draft} onChange={setDraft} />;
}
```

Prefer:

```tsx
function DocumentView({ document }: { document: Document }) {
  return <DocumentEditor key={document.id} initialText={document.text} />;
}

function DocumentEditor({ initialText }: { initialText: string }) {
  const [draft, setDraft] = useState(initialText);
  return <Editor value={draft} onChange={setDraft} />;
}
```

This example intentionally treats the draft as a snapshot taken when the document opens. If same-document updates must merge live, model that policy explicitly. Do not key blindly when retaining focus, DOM, animation, undo state, or a connection across entity changes is intentional product behavior.

## 2. Give editable state one owner

**Look for:** `useState(prop)` followed by an effect that copies the prop into state, dialog forms with reset effects, or several reset paths for the same field.

**Correct by:** choosing one ownership model. Use keyed mount-local state for a draft, controlled state for live parent ownership, or a render-time expression for derived data.

Avoid mirroring props with an effect:

```tsx
function RenameForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  return <Input value={name} onChange={(event) => setName(event.target.value)} />;
}
```

Prefer one honest ownership model:

```tsx
// Mount-local: the parent keys the form by entity.
<RenameForm key={session.sessionId} initialName={session.summary} />;

function RenameForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  return <Input value={name} onChange={(event) => setName(event.target.value)} />;
}

// Controlled: the parent owns every update.
function RenameForm({ name, onNameChange }: Props) {
  return <Input value={name} onChange={(event) => onNameChange(event.target.value)} />;
}

// Derived: no local state exists.
function SessionName({ session }: { session: Session }) {
  const displayName = session.name ?? session.summary;
  return <span>{displayName}</span>;
}
```

For dialogs, colocate form state inside content that unmounts on close. If the container persists while its target changes, key the form by that target's ID.

## 3. Store only independent state

**Look for:** state whose only setter runs in an effect, cached booleans or labels computed from current inputs, or multiple state values that can disagree.

**Correct by:** storing only independent domain state, such as user input or a lifecycle status, then computing the rest during render.

Avoid:

```tsx
const [isEmpty, setIsEmpty] = useState(false);

useEffect(() => {
  setIsEmpty(items.length === 0);
}, [items]);
```

Prefer:

```tsx
const isEmpty = items.length === 0;
```

When the next value depends on the previous value, use a functional update so asynchronous or repeated updates cannot close over stale state:

```tsx
setItems((current) => [...current, item]);
```

Use lazy initialization when creating an expensive mount-local value; otherwise React evaluates the initializer on every render:

```tsx
const [index] = useState(() => buildSearchIndex(initialItems));
```

Do not use local state as a cache for calculations React Compiler can optimize.

## 4. Keep transitions explicit and effects external

**Look for:** effects that only derive React state, effects triggered by a state flag set in a click handler, or effects that sequence internal work without synchronizing an external system.

**Correct by:** deriving values during render, applying transitions in the handler or reducer that receives their event, and reserving effects for synchronization with subscriptions, timers, DOM APIs, network lifecycles, browser storage, and imperative objects. Add cleanup when the setup creates an ongoing resource; an external write does not inherently need one.

Avoid using an effect to continue an interaction:

```tsx
function SaveButton() {
  const [shouldSave, setShouldSave] = useState(false);

  useEffect(() => {
    if (shouldSave) void saveDocument();
  }, [shouldSave]);

  return <button onClick={() => setShouldSave(true)}>Save</button>;
}
```

Prefer:

```tsx
function SaveButton() {
  return <button onClick={() => void saveDocument()}>Save</button>;
}
```

A real synchronization effect should expose its lifetime clearly:

```tsx
useEffect(() => {
  const unsubscribe = source.subscribe(setValue);
  return unsubscribe;
}, [source]);
```

When a real subscription should use the latest callback without resubscribing, use an Effect Event:

```tsx
const onMessage = useEffectEvent(props.onMessage);

useEffect(() => {
  return channel.subscribe((message) => onMessage(message));
}, [channel]);
```

Do not add an Effect Event to the dependency array or use one to hide a value that should cause resubscription. Dependencies should describe the external subscription identity.

## 5. Model resource lifetimes directly

**Look for:** `useMemo(() => new Class(...))`, imperative resources recreated when incidental props change, or refs used for values that affect rendering.

**Correct by:** giving the resource its real lifetime: lazy state for one instance per mount, a ref for non-rendered mutable state, a semantic key for replacement, or an explicit update method for continuity.

Avoid using memoization as lifecycle management:

```tsx
const bridge = useMemo(() => new VoiceBridge(context), [context]);
```

Prefer one bridge per mounted identity:

```tsx
const [bridge] = useState(() => new VoiceBridge(context));
```

If `context` identifies a different bridge, key the owner by that identity. If the same bridge must absorb context changes, expose an explicit update operation.

Use a ref only for mutable imperative state that must not affect rendering. Use module scope for truly shared constants, component types, and store definitions.

## 6. Let React Compiler own render memoization

**Look for:** imports of `memo`, `useMemo`, or `useCallback`; dependency arrays maintained only for render performance; or code made less direct to preserve ordinary callback identity.

**Correct by:** writing the calculation or callback directly and letting React Compiler prove and generate the optimization.

Avoid:

```tsx
const isBusy = useMemo(() => pending || streaming, [pending, streaming]);
const handleOpen = useCallback(() => openSession(sessionId), [openSession, sessionId]);
```

Prefer:

```tsx
const isBusy = pending || streaming;
const handleOpen = () => openSession(sessionId);
```

Do not add `memo`, `useMemo`, or `useCallback` preemptively.

A targeted exception is valid only when:

- function or object identity is part of an external API contract; or
- profiling demonstrates a material problem the compiler does not solve.

Document the concrete contract or measurement adjacent to the exception. Never add an exception solely to quiet an effect dependency.

## 7. Keep component types stable

**Look for:** a capitalized function declared inside a component and rendered as JSX. React sees a new component type on every parent render and remounts it.

**Correct by:** moving a reusable or stateful component to module scope. Inline trivial one-use JSX instead of inventing another component.

Avoid:

```tsx
function SessionPane({ session }: Props) {
  function Header() {
    return <h1>{session.title}</h1>;
  }

  return <Header />;
}
```

Prefer:

```tsx
function SessionHeader({ title }: { title: string }) {
  return <h1>{title}</h1>;
}

function SessionPane({ session }: Props) {
  return <SessionHeader title={session.title} />;
}
```

Choose props by semantics. Pass a domain object when the child operates on that object; pass individual fields when they are the child's complete contract. Do not split props solely for speculative render performance.

## 8. Subscribe at the semantic consumption boundary

**Look for:** a leaf reading `workspaceStateAtom` for one field, a parent subscribing only to pass status downward, or `atom(...)` called during render.

**Correct by:** subscribing to a narrow module-scoped or family atom at the closest consumer when that state is the consumer's own domain dependency. Keep a prop when the parent already owns the value or the child should remain independent of the workspace store. Either way, avoid making a broad state subscription merely to read one projection.

Avoid:

```tsx
function SessionListItem({ session }: { session: SessionMetadata }) {
  const workspace = useAtomValue(workspaceStateAtom);
  const status = workspace.sessionStates[session.sessionId]?.status ?? "idle";
  return <SessionRow session={session} status={status} />;
}
```

Prefer:

```tsx
function SessionListItem({ session }: { session: SessionMetadata }) {
  const status = useAtomValue(sessionStatusAtom(session.sessionId));
  return <SessionRow session={session} status={status} />;
}
```

Keep atom identity stable:

```tsx
// Avoid: creates a different atom during render.
const count = useAtomValue(atom(0));

// Prefer module scope or an atom family.
const countAtom = atom(0);
const sessionStatusAtom = atomFamily((id: string) => atom((get) => get(stateAtom)[id]));
```

Do not create a derived atom merely to avoid a simple prop. Use one when the value is shared, independently reactive, or expresses a real domain projection.

## 9. Keep server state in React Query

**Look for:** query data copied into local state and kept synchronized by an effect, ad hoc fetch effects duplicating a query, or query-function inputs absent from the query key.

**Correct by:** rendering authoritative query data directly and applying writes through mutations or intentional optimistic cache updates.

Avoid:

```tsx
const { data } = useQuery(sessionQueries.detail(sessionId));
const [session, setSession] = useState(data);

useEffect(() => {
  setSession(data);
}, [data]);
```

Prefer consuming query data directly and applying edits through mutations or intentional optimistic cache updates:

```tsx
const { data: session } = useQuery(sessionQueries.detail(sessionId));
```

Every semantic input used by a query function belongs in its query key. An incidental transport handle may be omitted only when the key still identifies the complete cached resource; document that exception at the query factory.

A local editable draft initialized from query data is valid when snapshot semantics are intentional and the form is mounted or keyed for one entity. Do not continuously synchronize that draft and overwrite user edits.

## Review threshold

Raise a finding when one of these patterns obscures ownership or transitions, risks stale behavior, or causes measured unnecessary work. Existing code does not need to match every preferred shape when its contract is already clear.
