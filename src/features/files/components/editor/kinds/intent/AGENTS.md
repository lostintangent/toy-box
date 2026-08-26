# Intent editor

This directory owns the `.intent` object model and editor. An `IntentDocument`
is one strict, flexible sequence of sections. Findings preserve the settled
facts that shape a change; description, definition, and resolution sections form
the effective spec; zero or more top-level plan sections form the optional plan
that makes a settled spec executable. These are derived semantic roles, not
stored wrapper objects or prescribed layouts. Research is the process that
produces findings, not a parallel lifecycle state. There is no review state or
alternate editor mode; a completed plan may explicitly request an outcome
review that either leaves it complete or appends ordered follow-up work.

## Ownership

- `model/` owns the domain boundary. Consumers import its stable public surface
  from `model/index.ts`; internal modules import the module that owns a concept.
  - `schema.ts` owns the strict Zod schemas, inferred domain types,
    `parseIntent`, and `serializeIntent`. Runtime schemas are the only source of
    domain types and close the parse boundary with semantic validation.
    `FindingsSection` owns source-backed discoveries. `DefinitionSection` is
    records or exhibits and `ResolutionSection` is questions or decisions.
    Together with Markdown and list sections, the latter form `SpecSection`;
    `IntentSection` adds findings and top-level plan sections. Description
    remains a semantic role, not another wrapper type.
  - `validation.ts` owns document-wide identity, reference, field, source,
    question, decision, exhibit, and tree rules. It delegates flow and plan
    invariants to their semantic owners.
  - `query/` owns pure reads. `structure.ts` builds the flattened section index
    and schema paths. `reading.ts` resolves tabs, findings and their grounded
    entities, decision contributions, records, decision-owned relationships,
    and inspectable entities.
  - `spec/` owns spec algebra. `state.ts` derives guidance, requirements, open
    questions, unresolved decisions, and settlement. `flow.ts` validates and
    projects authoritative flow exhibits through nodes, connections, paths,
    regions, and stages. `index.ts` is the internal facade.
  - `plan/` owns plan algebra. `steps.ts` traverses top-level plan sections and
    their flat or phase-owned steps. `state.ts` evaluates the aggregate plan
    against `SpecState` and derives current steps, resolved targets, unplanned
    requirements, `fullyPlanned`, status, and executability. `validation.ts`
    owns plan invariants. `index.ts` is the internal facade.
  - `issues.ts` owns shared validation issue primitives so document, flow, and
    plan rules report consistent paths and messages.
  - `edit/` owns immutable editor operations. `policy.ts` decides which sections
    a worker may regenerate; `transitions.ts` exposes disclosure, decision,
    question, content-editing, and removal verbs; `repair.ts` synchronously
    restores every reference invariant after removal; `sections.ts` owns the
    immutable traversal of authored sections; `index.ts` is the internal facade.
  - `testFixtures.ts` owns shared test-only documents and lookups.
- Runtime dependencies remain acyclic: query structure indexes schema values;
  plan traversal and query reading build on that structure; spec projections
  build on query reading; plan state consumes spec state; editing composes these
  pure capabilities at the write boundary; validation orchestrates their rules;
  and schema closes parsing. Reverse schema imports are type-only.
- `IntentEditor.tsx` owns the document shell, browser-local tab selection,
  section order, undo snapshot, persistence orchestration, and editor actions.
- `sections/` owns presentation behind `sections/index.ts`. `content.tsx`
  dispatches the taxonomy; `findings/` renders compact
  statements with evidence disclosed on demand; `description/` renders Markdown
  and lists; `definition/`
  renders records and authoritative exhibits, including flows; `resolution/`
  renders questions and decisions; `plan/` renders the execution plan.
  `presentation.ts` owns section counts and `shared.tsx` owns common chrome,
  tags, and decision-relationship labels.
- `inspector/` owns contextual entity reading and direct editing behind its
  facade. `EntityInspector.tsx` composes the selected entity;
  `FindingEditor.tsx`, `RecordEditor.tsx`, `ExhibitEditor.tsx`, and
  `PlanStepEditor.tsx` own their distinct forms; `FieldEditor.tsx` owns only
  their genuinely shared controls.

Rendering may ask the model for projections, but it must not reimplement spec
state, plan state, flow traversal, implementation coverage, repair, or ordering.
Review is a human activity over the spec, not another domain state.

## Document model

The title is the document's only root reader-facing content. The root has no
entity ID; the containing file supplies document identity. Opening explanation is
an ordinary Markdown section in authored order.

Sections may be `findings`, `markdown`, `list`, `records`, `exhibits`,
`questions`, `decisions`, or `plan`. Every section has a required `purpose`,
used as authoring guidance and shown through its title tooltip. `collapsed` is
shared document state.

Optional root tabs partition top-level sections by reference. A tab set has at
least two uniquely titled tabs; tabs have no ID or intent identity; every
top-level section belongs to exactly one tab; and document section order remains
canonical. Selection is browser-local, while parsing, workers, inspection, and
derived spec/plan state always consume the complete document.

### Findings

A findings section preserves only settled discoveries that materially shape the
spec. Each finding owns a stable ID, one concise statement, optional Markdown
explaining why it matters, and sources governed by the section's `code`,
`reference`, or `optional` source policy. Questions hold unsettled facts;
findings hold facts already established. There is deliberately no derived
research state because the document cannot infer whether investigation found
every relevant fact.

A finding may attach one supporting exhibit when a flow, tree, pseudocode,
image, or HTML rendering communicates the evidence better than prose.
That exhibit must describe `existing` reality and remains local evidence, not an
independently addressable spec requirement. Records, authoritative spec
exhibits, and decisions may own optional `basedOn` references to findings. These
links make the reasoning traceable in both directions without making findings
plan targets. Removing a finding prunes every `basedOn` reference.

### Description

Markdown sections and list sections describe the spec literally. Their strings
and exhibit descriptions render as Markdown through Streamdown. Markdown is
presentation syntax over ordinary non-empty strings, not a separate Intent text
model.

### Definition

Records define repeated, individually addressable requirements or context with
task-local fields and a persisted table/cards presentation. Exhibits define one
authoritative visual or structured requirement:

- `pseudocode` captures an interface, schema, protocol, configuration shape, or
  algorithm whose structure matters without prescribing final implementation
  source.
- `tree` captures one or more rooted `files` or `domain` hierarchies. Entries
  may be `new`, `modified`, or `removed`, but remain local to the exhibit.
- `image` references a local or remote visual and requires alternative text.
- `html` embeds authoritative HTML/SVG or references an existing rendered file;
  both use the shared sandboxed document boundary.
- `flow` captures an authoritative directed behavior or control flow. It owns
  its nodes, connections, named paths, and optional regions as one exhibit.

A flow node is either `{ entity }`, which reuses a shared spec entity by stable
ID, or a local `{ id, title, description?, change? }` waypoint meaningful only
inside that flow. Shared nodes preserve one source of truth and remain directly
inspectable and plan-addressable. Local waypoints prevent incidental visual
detail from polluting the document-wide ontology. A flow cannot contain itself
as a shared node.

Connections belong to the flow that defines them and carry a local stable ID,
source node, target node, and reader-facing label. Every node participates in a
connection. Each named path chooses one or more owned connections and a start
node; all selected connections must be reachable outward from that start. The
union of path connections is acyclic. A connection omitted from every path is a
supporting connection and may connect only nodes already placed by paths.
Optional regions name exclusive groups of path-placed nodes. The renderer opens
on the first authored path, offers Whole flow, preserves the staged path visual,
and derives supporting connections, change legend, and inspector links from the
same authored graph. There is no network mode, view toggle, global connection
bag, or separate map section.

### Resolution

Questions capture factual uncertainty and how it should be answered. Decisions
capture human-owned alternatives, optional additions to records sections, an
optional exhibit, and a provisional or decided choice. The exhibit stays
visible and inspectable with its option for comparison, but becomes a
requirement only when that option is decided. An option may own relationships
among shared entities and its own additions or exhibit. Those relationships
express the option's consequences and remain local to the option; they are not
a document-wide topology and do not feed flow rendering.

### Derived spec

The effective spec is the reading formed by description, definition, and
resolution sections, not a stored wrapper or special section kind. Description
sections explain it; definition sections codify and visualize addressable
elements; resolution sections settle what is unknown; section order and tabs
organize the document. Findings ground the spec but remain outside it.

`SpecState` distills only execution-relevant facts: Markdown/list guidance,
current requirements, open questions, unresolved decisions, and settlement.
Non-`existing` records and exhibits, including a changed flow as one coherent
requirement, become requirements. Decided option additions and the selected
option exhibit become requirements. A decided choice becomes a requirement only
when its selected option contributes neither. Existing records and provisional
choices remain context.

## Plan model

Zero or more top-level `plan` sections collectively form one optional plan.
`planSections(document)` returns them in document order; no sections means no
plan, not a synthetic missing status. One section is the ordinary case.
Additional sections alter presentation or task-local fields, not execution
identity or lifecycle.

Each plan section owns steps with globally unique IDs, a title, required
`doneWhen`, section-local values, optional status, and one or more direct
`implements` references. A step may reference Markdown/list guidance,
non-`existing` records or exhibits, decided additions, or a decision with a
self-contained option. Option exhibits are potential targets while authored and
become current only with their decided option. Findings and their supporting
exhibits are evidence, not implementation targets. A flow exhibit and any shared
requirements used inside that flow are independent implementation targets: the
plan may reference the whole flow, the shared requirements, or both. Flow-local
nodes, connections, paths, and regions are deliberately not plan targets.

A flat plan section owns ordered steps. A phased section owns ordered named
groups of ordered steps. Phases are grouping-only values, not intent entities,
dependency waves, or concurrency declarations. Document order across plan
sections, then phase and step order, defines execution order.

Step status is absent before execution, `in-progress` while it runs, and
`complete` after its completion criterion and verification pass. The worker
ordinarily advances status; the editor permits explicit correction. Phase and
plan status derive from current steps as `not-started`, `in-progress`, or
`complete`.

`planState(planSections(document), specState(document))` derives current steps,
resolved targets, unplanned requirements, `fullyPlanned`, aggregate status, and
`canExecute`. A document can execute only when it has a plan, the spec is
settled, every current requirement is implemented, and plan status is not
complete. A complete fully planned document shows a green check; a document
without plan sections exposes no execution action. The completed state exposes
an optional outcome-review action. Review preserves completed status and, when
evidence warrants another pass, appends new unstarted work so the same derived
plan becomes executable again without a separate review state.

## Invariants

- Keep the current schema strict and authoritative. There is no legacy parser or
  compatibility shape.
- Preserve globally unique stable IDs for sections, records, plan steps,
  findings, supporting finding exhibits, exhibits, questions, decisions, and
  decision-option additions and exhibits. Decision relationship IDs share their
  own document-wide namespace. Flow node, connection, path, region, and phase
  IDs are local to their owner.
- Resolve references at parse time, including inactive decision options. Never
  duplicate shared entities merely to render a flow or plan.
- Keep tabs reference-only and preserve their exact top-level partition when
  sections change.
- Every editable section exposes its action menu. Regenerate is controlled by
  `canRegenerateSection`; Delete uses the reference-safe section transition and
  preserves at least one valid document section.
- `IntentEditor` retains one pre-removal snapshot for Undo. The next removal
  replaces it; a substantive commit or external revision clears it.
- Keep decision choice, spec state, planning coverage, status, flow projection,
  and order in pure model helpers shared by every consumer.
- Removing a shared entity prunes affected grounding links, flow nodes,
  connections, paths, regions, question/decision references, decision
  relationships, and plan implementation links synchronously. Remove any flow,
  exhibit section, step, phase, or plan section that can no longer satisfy its
  minimum valid shape.
- An exhibit's kind, embedded-versus-referenced form, and stable identity remain
  fixed through direct edits. A user may directly remove only a `new`
  section-owned exhibit; option exhibits remain part of their authoritative
  option. Repair all references before the next document is observable.

When this model changes, update the bundled authoring skill, schema reference,
and worked example in `src/features/files/server/skills/create-toy-box-intent/`.
When plan execution changes, update the separate
`src/features/files/server/skills/execute-toy-box-intent/` skill as well.
