# SVG Artifact Editor

The SVG artifact kind presents an ordinary `.svg` file as a native browser-rendered document with a transient editor layered around it. It does not translate SVG into a proprietary scene graph. The parsed SVG DOM is the authoritative editable document, while Toy Box owns the tools, selection, viewport, gestures, and history that make that document interactive.

## Mental model

The subsystem has three centers of responsibility:

- `SvgDocument` owns durable SVG meaning: parsing and validation, one live native SVG tree, node construction and mutation, serialization, and publication of changed source.
- `EditorState` describes the complete transient editing layer: read-only policy, viewport, active tool and style defaults, selection, the gesture pending completion, and reversible history. One mount-local TanStack store owns that value and exposes the editor's semantic actions.
- `Editor` composes the experience. It connects the document and store to drawing, selection, navigation, keyboard input, image handling, toolbars, and the visible layer order.

React owns component lifetimes and presentation. The TanStack store owns state shared across independently reactive editor capabilities. Pointer-rate details that exist only for one captured gesture stay in that gesture's controller rather than becoming global React or store state.

## Opening, changing, and saving a document

1. The artifact lifecycle supplies the current file source, revision, mode, and save function to `SvgArtifact`.
2. `SvgArtifact` creates one `SvgDocument` and one editor store for that mounted artifact. A path or session change remounts the artifact; a mode change updates the existing editor's read-only policy.
3. On open or external revision, `SvgDocument` parses and validates the source into a native `<svg>` root. The editor clears DOM-backed selection, active gestures, and history, then recomputes any fitted viewport against the new page.
4. `DocumentLayer` mounts the native root inside an isolated shadow host and projects the editor viewport through the root's runtime `viewBox`.
5. Editor commands mutate the live native DOM and record the corresponding reversible history entry. Publishing serializes the current SVG and hands the resulting source back to the ordinary artifact save lifecycle.

Runtime presentation never changes the file's authored viewport or base URI: serialization restores those authored attributes. Selection chrome, the grid, tool state, viewport, and history are editor state and never enter the persisted SVG.

## Pointer gestures

Drawing, selection, and viewport navigation are gesture sources. On pointer-down, only the source for the effective tool may claim the pointer. A successful claim returns a controller that exclusively owns subsequent pointer updates until commit or cancellation; pointer capture belongs to that same lifecycle.

The store's `gesture` value is the observable semantic state needed by React—for example, `pan`, `draw`, `marquee`, or `transform`. The controller holds only the imperative details of that one pointer lifetime. Finishing commits one editor operation; cancelling a document edit restores its provisional DOM changes.

Holding Space temporarily switches between hand and select while the editor itself has focus. Text entry and toolbar controls retain their native Space behavior.

## Selection and text

Selection always refers to native `SVGGraphicsElement` nodes in the current document. Browser hit paths prefer text, then a named authored group, then the deepest renderable element. Marquee selection uses the same authored-group boundaries and selects only elements fully enclosed by the marquee.

`useSelection` owns selection policy and commands. `SelectionLayer` measures the selected native geometry and paints transient member outlines, the shared manipulation frame, and its adaptive handles in viewport coordinates. Single and multi-element selections therefore share one manipulation model without modifying the SVG merely to show selection.

Selected SVG `<text>` remains real SVG text. Because Chromium does not make an SVG text node directly content-editable, the mounted HTML host temporarily becomes editable while one text element is selected. Browser input changes the real text subtree in place; leaving the edit records its net change as one Toy Box history entry.

## Moving, resizing, and rotating

A transform gesture captures every selected element's current native transform and screen relationship before it begins. Pointer movement is expressed in screen coordinates and translated back into each element's local SVG transform, preserving existing nested transforms.

The live DOM updates throughout the gesture so movement, resize, rotation, and line-endpoint editing are immediate. Completion records the before/after attributes as one history entry; cancellation restores the captured attributes. A click on a selected target stays pending until it crosses the drag threshold, which preserves native text caret placement without a text-specific drag path.

## Drawing and erasing

The active drawing tool and style defaults determine which native node is created. A drawing controller inserts that provisional node directly into the authoritative SVG and mutates it as the pointer moves. This makes paths, shape strokes, and fills visible immediately. Completion records the already-applied edit in history; cancellation removes it.

Text creation uses a transient HTML input positioned over the intended document point, then appends one native SVG text node. The eraser uses ordinary SVG luminance masks rather than a background-colored stroke. Its path updates live inside the document, persists as valid SVG, and needs no editor-specific reconstruction when the file is reopened.

## Panning and zooming

The viewport store value contains the pane size, zoom, pan, and whether it is fitting the page, fitting content, or manually positioned.

- The hand tool and middle pointer button claim pan gestures.
- Wheel and pane commands zoom around a viewport point or fit the authored page/content.
- A `ResizeObserver` updates pane size. Fit modes recompute their position as the pane changes; manual mode preserves the user's chosen view.
- `DocumentLayer` turns viewport state into the native SVG `viewBox`, while `GridLayer` paints the dot grid with the same transform. Document content and editor feedback therefore remain aligned without rewriting authored geometry.

## Other editor commands

- Style actions apply to a compatible selection when the select tool is active; otherwise they update the defaults retained for future drawing.
- Undo and redo apply native DOM history entries and discard any selection whose nodes are no longer attached.
- Image paste, file selection, and drag-and-drop decode supported raster files and insert one native SVG image element through the store.
- Read-only policy is enforced at interaction entry points. The document still renders and navigates, but mutating tools and commands cannot claim work.

## Folder story

- `store/` is the editor's semantic center: `types` introduces its nouns, `store` implements their actions, and `viewport` contains pure navigation transitions.
- `document/` owns the durable native SVG boundary: source parsing, the live document, node construction, styles, and reversible DOM entries.
- `SvgArtifact` binds the ordinary artifact lifecycle to one document and store.
- `editor/Editor` is the composition root. Its subfolders own document mounting and keyboard input, drawing, gestures, images, selection, and viewport presentation.
- `toolbar/` projects store state into the floating editor toolbar and pane actions.

## Invariants

- Keep the native SVG DOM authoritative; do not introduce a parallel shape model.
- Keep durable SVG semantics in `document/` and transient interaction semantics in the editor store.
- Clear every DOM-backed transient value when a different document is loaded.
- Pair every committed native mutation with one reversible history entry and one source publication.
- Keep gesture admission declarative and let one controller own an accepted pointer through completion.
- Keep overlays and runtime viewport attributes out of serialized SVG.
- Subscribe React components only to the store slices they render; read current store state directly inside event-time commands.
