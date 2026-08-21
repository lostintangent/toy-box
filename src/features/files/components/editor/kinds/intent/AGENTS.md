# Intent editor

This directory owns the `.intent` domain model and editor. An Intent is one
strict document whose authored sections tell a complete top-to-bottom
story. Relationships enrich that story through inline map sections and
dependency-aware sequence sections; there is no alternate View or Explore
mode.

## Ownership

- `model/` owns the whole domain boundary. Consumers import the stable public
  API from `./model/index`; each module below owns one responsibility and internal
  modules import those owners directly rather than the facade.
  - `model/index.ts` is a public facade only: it re-exports the schema, domain
    types, and public capabilities and contains no logic.
  - `model/schema.ts` owns the strict Zod schemas, the inferred domain types,
    `parseIntent`, and `serializeIntent`. The runtime schema is the source of
    types and wires semantic refinement from `validation.ts`.
  - `model/validation.ts` owns global semantic validation: ID uniqueness,
    references, records and fields, provenance, and decision/question rules. It
    delegates map and delivery rules to their owners.
  - `model/relations.ts` owns the shared relation algebra: entity IDs, authored
    relations, relationship-map candidates, ordered outward reachability, cycle
    detection, and dependency phases.
  - `model/read.ts` owns the flattened section and item-type index plus document
    locations (section, decision, and question paths).
  - `model/sequence.ts` owns work-item traversal: flat vs staged entries,
    stable paths, and previous-item lookup.
  - `model/projection.ts` owns reader-facing projections: active decision state,
    selected additions, projected records, effective relations, entities and
    lookup, and record/field labels.
  - `model/maps.ts` owns map validation and map projection: relationship and
    intent map relations, graph output, rooted paths, regions, and stages.
  - `model/delivery.ts` owns delivery validation and projection: settled
    structured obligations, work units and phases, coverage, and execution
    readiness.
  - `model/workflow.ts` owns unresolved question dependencies and review
    readiness.
  - `model/issues.ts` owns the shared refinement context and issue primitives so
    validation, maps, and delivery report identical paths and messages.
  - `model/display.ts` owns section item counts and the refresh policy, which
    compose map and record projections.
  - `model/checkpoints.ts` owns checkpoint manifests: saving, comparing against
    the durable `savedVersion`, semantic section/decision projections, and
    fingerprinting.
  - `model/transitions.ts` owns editor-initiated immutable transitions over an
    `IntentDefinition`: disclosure, decision and question lifecycle, editable
    content updates, and graph-safe removal.
  - `model/richText.ts` owns the deliberately small rich-text subset used by
    prose and list content.
  - `model/testFixtures.ts` owns test-only fixture builders shared by the
    focused suites next to their owners.
- Runtime dependencies remain acyclic: `read`, `sequence`, and `richText` are
  leaves; `relations` builds on `read`; `projection` builds on those primitives;
  maps and delivery build on projection; workflow builds on the section index;
  validation orchestrates those owners;
  and schema closes the parse boundary. Reverse references to schema are
  type-only, so `schema.ts` can runtime-import `validateDefinition` safely.
- `IntentEditor.tsx` owns the document shell, section order, editor actions, and
  checkpoint control.
- `sections/` owns ordinary section presentation behind its `index.ts` facade:
  `content.tsx` dispatches section kinds and composes groups; `records.tsx` owns
  record projections and view controls; `workflow.tsx` owns questions and
  decisions; `exhibits.tsx` owns reusable exhibit cards; `map.tsx` and
  `sequence.tsx` render their model projections; and `shared.tsx` owns section
  chrome, rich text, tags, and relation labels. Records sections choose a persisted
  `table` or `cards` view that readers can switch.
- `EntityInspector.tsx` owns contextual entity reading and editing.
- `VersionControl.tsx` owns checkpoint comparison presentation.

Keep this boundary semantic: rendering may ask the model for projections, but it
must not reimplement readiness, graph traversal, coverage, or ordering policy.

## Document model

The title is the document's only root reader-facing content. Any opening
explanation is an ordinary prose section in the authored sequence.

Top-level sections may be prose, list, records, sequence, exhibits,
questions, decisions, map, or group. Groups contain one level of non-map leaf
sections. Every section has a required purpose that guides workers and appears
only from the title's info tooltip. Its `collapsed` value is shared document
state and updates when an editor disclosure control is used.

Prose bodies render Markdown through the same Streamdown configuration as
session transcript text. Compact list entries, exhibit descriptions, and
procedure instructions retain the limited inline strong-emphasis and code form.
Image exhibits reference local or remote visuals, including SVG files. HTML
exhibits either reference a rendered document or embed exact HTML or SVG content
inside the same sandboxed document boundary.

Every section is itself a graph entity. Records sections additionally introduce
record entities, sequence sections introduce work entities, exhibits sections
introduce exhibit entities, and questions and decisions introduce their
corresponding workflow entities. Prose and list content remains on its section
entity; groups organize sections; maps only project existing entities.

A map section references existing entities and relationships. `flow` and
`network` project one selected graph; `paths` names rooted subgraphs and may add
supporting links and exclusive regions. Maps do not copy content and cannot be
worker-refreshed.

At most one native `sequence` section may exist. Its lean items are first-class
implementation work entities with globally unique IDs, a title, and task-defined
values.
An ungrouped sequence owns `items` directly; when dependency phases have useful
task-local names, `stages` own those same items in named groups. Stages are
authored containers, not graph entities. Their membership and order must match
the phases derived from labeled root `depends-on` edges, so names cannot become a
second delivery model. `implemented-by` edges provide obligation coverage.
Records change state, provenance, subject configuration, and decision additions
do not apply to work items.

`savedVersion` is an editor-owned checkpoint manifest. Authors and workers
preserve it unchanged; the header control saves or compares checkpoints without
adding authored content. Disclosure and records-view changes are excluded from
checkpoint fingerprints.

## Invariants

- Keep schemas strict. Do not add compatibility aliases for retired keys.
- Preserve globally unique and stable graph entity IDs across sections, records,
  work, exhibits, questions, and decisions. Relationship IDs use their own global
  namespace; path, region, stage, and other container IDs remain local to their
  owners.
- Resolve all references at parse time, including inactive decision options.
- Never duplicate authored entities to satisfy a map or sequence renderer.
- Keep decision choice, readiness, obligation coverage, and delivery ordering in
  pure model helpers shared by every consumer.
- Removing an entity must prune affected relationships, map selectors, paths,
  regions, and workflow references while preserving `savedVersion` so the
  checkpoint comparison can report the removal.
- Preserve `savedVersion` across worker rewrites.

When changing this area, update the authoritative bundled skill schema and
worked example in `src/features/files/server/skills/create-toy-box-intent/`.
