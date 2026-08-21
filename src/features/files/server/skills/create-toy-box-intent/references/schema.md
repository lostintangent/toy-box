# The `.intent` format

A `.intent` file is a strict, task-defined review form for one
consequential change. Toy Box owns a small algebra of sections, fields, review
annotations, workflow, relationships, and inline visualizations. The author owns
the form assembled from those primitives: no Domain impact, Product impact,
requirements, safety, or other section is mandatory.

The file is authoritative; the editor is a progressive lens over it. Unknown
and retired fields are invalid rather than migrated, preserved, or silently
dropped.

```jsonc
{
  "title": "string",
  "sections": [Section],
  "relations": [Relation],
  "savedVersion": SavedVersion | undefined
}
```

## Opening

`title` is the document's stable identity and its only root reader-facing
content. It should be a concise change headline suitable for a list or document
header. Put any useful orientation in an ordinary task-named prose section, or
let the first structured section begin when it gets to the point faster.

Every reader-facing title, purpose, subject, field label, option label, question,
and rationale should use the task's own vocabulary. The schema's generic terms
must not leak into the document's voice. Prefer "What gets copied", "What
survives a restart", "Where rendering lives", "How we'll build it", or "Leave
alone" over Domain impact, Product impact, System fit, Delivery requirements, or
Implementation work. Read the visible document aloud: a teammate should
recognize its language without knowing this format.

The authored document is the complete reading. It must explain the change clearly
from top to bottom without requiring an inspector or hidden provenance. Those
tools add depth; they may not rescue an obtuse document.

## Reading model: bespoke coherence and depth

Authored order is meaningful, but no universal story arc is required. The
visible document should take the shape that best explains this task. A terminal
change may read as a reconnect journey, an app-copy change as a policy
comparison, a scheduler change as interacting rules and decisions, and a
research task as evidence converging on a choice. None of those forms is the
default for the others.

The graph should preserve that task-specific shape rather than normalize it into
generic "current / future / architecture / plan" sections. Nodes carry the
domain's own concepts; relationships preserve its real causality, sequence,
ownership, dependency, or preservation; authored sections arrange those nodes
for the clearest primary reading.

When architectural fit is material, explain it in the form that matches the
task: an ownership topology, lifecycle, data path, before-and-after boundary,
causal chain, comparison, or concise prose. Include only the distinctions
needed to understand why the change belongs there. A file-by-file inventory is
implementation trivia, not architecture, and an architecture section added by
habit is no better.

Progressive disclosure is a set of optional composition tools, not a workflow.
Open authored sections provide the primary reading. Collapsed sections can hold
supporting detail that would interrupt it. Map sections can project the same
entities inline where topology clarifies the reading. Inspectors and
provenance can expose exact records, sources, rationale, and editing.

No essential premise may exist only in an inspector or tooltip. Conversely,
deeper detail should not repeat the opening in more formal language. Each
disclosure should add precision while preserving the same domain nouns and graph
identities.

## Section algebra

Every section declares:

```jsonc
{
  "id": "globally-unique-graph-entity-id",
  "title": "reader-facing heading",
  "purpose": "why this section exists and how its content should be interpreted",
  "collapsed": false,
}
```

`purpose` is semantic guidance, not a subtitle. It lets generic workers explain
why a task-specific section exists without Toy Box knowing the team's ontology.
Readers can reveal it from the info control beside the section title, so write a
short natural sentence that adds rationale instead of restating the title or
content.

Top-level sections may be `prose`, `list`, `records`, `sequence`,
`exhibits`, `questions`, `decisions`, `map`, or `group`. A group contains one
level of non-map leaf subsections. This bounded hierarchy supports authored
sections and subsections while keeping readiness, references, validation, and
rendering deterministic.

Authored order is meaningful everywhere. Do not globally sort sections,
subsections, fields, records, options, or list items.

Use `collapsed` deliberately for progressive disclosure. The default Intent
reading should expose the primary outcome and unsettled choices first;
supporting architecture, provenance, field vocabularies, and non-goals can
remain available without competing for the opening viewport. When architectural
fit is essential to understanding the change, keep that essential fit in the
primary reading and collapse only the supporting mechanics.

`collapsed` is shared document state. Expanding or collapsing a section in an
editable board persists the new value, including Expand all and Collapse all.
Workers preserve the current values unless the task intentionally restages the
opening. Disclosure-only changes do not count as checkpoint drift.

The complete authored document defines the intent. There is no second
section-level flag that marks some authored content as more authoritative than
the rest. Structured non-`existing` records and exhibits plus decided choices
become mechanically coverable implementation obligations. Prose and lists remain
authoritative guidance and may link to work when useful without being counted as
required coverage units.

## Prose sections

```jsonc
{
  "id": "experience",
  "title": "Experience",
  "purpose": "Describe the intended user-visible result.",
  "kind": "prose",
  "collapsed": false,
  "body": "One cohesive Markdown passage with **formatting** and [links](https://example.com).",
}
```

Use prose when it is the natural task-specific shape. Do not turn prose into a
fake table merely to make it machine-trackable. Prose bodies are Markdown,
rendered with the same parser and code highlighting as session transcript text.
They may use paragraphs, headings, emphasis, links, lists, blockquotes, tables,
and fenced code.

Keep a Markdown table or code block in prose only when it is incidental to the
passage and needs no independent identity. Use a records section when rows need
comparison, inspection, provenance, or relationships. Use a code exhibit when
exact source must be inspected, referenced, covered by delivery work, or
preserved as authored.

## List sections

```jsonc
{
  "id": "non-goals",
  "title": "Non-goals",
  "purpose": "Close plausible adjacent scope.",
  "kind": "list",
  "style": "bullet" | "ordered",
  "items": ["string"]
}
```

List items intentionally support only balanced strong emphasis and inline code.
Use a list when
its entries need no individual change annotation, provenance, explanation, or
field values. Use records when they do.

## Records sections

Records are the reusable structured-review primitive for items with change state,
provenance, explanations, or repeated fields. A records section can render as a
comparison table or responsive cards. Use one only when that per-record
structure improves understanding. Do not split ordinary prose into Subject /
Surfaces / Requirement rows: if the reader has to reassemble a sentence from
generic cells, use prose or a list.

`records` names this structural primitive, not its subject matter. Its records
may represent concepts, outcomes, boundaries, policies, paths, or any other
task-local entities. Use a reader-facing title such as "Concepts" when that is
what one particular section contains.

```jsonc
{
  "id": "tool-corpus",
  "title": "Tool corpus",
  "purpose": "Compare representative tools through a finite task vocabulary.",
  "kind": "records",
  "view": "table" | "cards",
  "provenance": "code" | "reference" | "optional",
  "subject": "optional reader-facing identity column",
  "fields": [Field],
  "items": [Record]
}
```

`subject` is optional so a pure field matrix does not need an invented identity
column. A records section must declare a subject or at least one field.

`table` is useful when several records need field-by-field comparison. `cards`
is useful for a small number of independently inspectable concepts. `view` is
shared document state: changing it in an editable board persists the selected
table-or-cards default, while a read-only board keeps only a local override.
Tables remain tables on narrow screens and scroll horizontally when needed.
View-only changes do not count as checkpoint drift. Delivery work belongs in a
native sequence section rather than another records view.

### Fields

```jsonc
Field =
  | {
      "id": "stable-field-id",
      "label": "reader-facing label",
      "kind": "text"
    }
  | {
      "id": "stable-field-id",
      "label": "reader-facing label",
      "kind": "choice",
      "cardinality": "one" | "many",
      "options": [{
        "id": "stable-option-id",
        "label": "reader-facing value",
        "description": "optional semantic clarification"
      }]
    }
```

Use text for open-ended task detail. Use a choice only for a real finite
vocabulary such as lifecycle state, rendering shape, ownership class, coverage,
or risk. Field and option IDs are durable data; labels are reader-facing
vocabulary. Colors and layout details are editor-owned and never persisted.

### Records

```jsonc
Record = {
  "id": "globally-unique-graph-entity-id",
  "subject": "required exactly when the records section declares subject",
  "change": Change,
  "values": {
    "text-field-id": "string",
    "single-choice-field-id": "option-id",
    "many-choice-field-id": ["option-id", "..."]
  },
  "provenance": "reference string",
  "explanation": "optional progressive context"
}

Change = "existing" | "new" | "modified" | "removed" | "preserved" |
         "renamed" | "split" | "relocated"
```

Every record supplies exactly the records section's fields. A text field accepts one
string. A single-choice field accepts one declared option ID. A many-choice
field accepts a non-empty, duplicate-free array of declared option IDs.

`change` describes the record's role:

- `existing`: adjacent context only.
- `new`, `modified`, `removed`, `renamed`, `split`, and `relocated`: target
  change.
- `preserved`: an existing behavior, structure, or boundary the change must
  explicitly keep.

When a record has provenance, the editor exposes that reference from the
record's change-state chip instead of adding a separate source control.

The editor can update a shared or option-owned record directly from its
inspector. Direct edits preserve `id` and option ownership so every relationship
continues to point at the same node. The editor validates the complete document,
including field vocabularies, provenance, references, coverage, and dependency
rules, before saving. If the same record changed after the form opened, the save
is rejected instead of overwriting the newer version; unrelated edits can merge.

There is no observed/inferred or required/recommended axis. A proposal the human
has not accepted belongs in a decision option.

### Provenance policy

Each records section chooses its own grounding policy:

- `code`: every non-`new` record requires a workspace-relative code location
  with an optional `#Symbol`; provided provenance on new records must use the
  same format.
- `reference`: every non-`new` record requires a non-empty task-relevant
  reference, such as a URL, document anchor, trace, dataset, or code location.
- `optional`: provenance may be omitted for every change kind.

This keeps code-grounded engineering forms strict without forcing a code
location onto research, product, operational, or externally grounded forms.
When required provenance cannot settle a material claim, open a factual
question instead of presenting the claim as settled.

### Progressive explanations

`explanation` adds rationale, boundaries, examples, or implications without
creating another requirement surface. It may not weaken, broaden, or condition the
record's values. Do not hide another record, evidence source, implementation
plan, or competing alternative inside an explanation.

## Sequence sections

A sequence is the native delivery primitive. It owns implementation work rather
than presenting records through another lens:

```jsonc
SequenceSection =
  | {
      "id": "delivery-work",
      "title": "How we'll land it",
      "purpose": "Keep independently verifiable work in dependency order.",
      "kind": "sequence",
      "collapsed": true,
      "fields": [
        { "id": "home", "label": "Where it lands", "kind": "text" },
        { "id": "done", "label": "Done when", "kind": "text" },
      ],
      "items": [WorkItem]
    }
  | {
      "id": "delivery-work",
      "title": "How we'll land it",
      "purpose": "Name the meaningful phases in this delivery story.",
      "kind": "sequence",
      "collapsed": true,
      "fields": [
        { "id": "home", "label": "Where it lands", "kind": "text" },
        { "id": "done", "label": "Done when", "kind": "text" },
      ],
      "stages": [{
        "id": "shared-foundation",
        "title": "Establish one authoritative configuration",
        "items": [WorkItem]
      }]
    }

WorkItem = {
  "id": "shared-foundation-work",
  "title": "Define the shared model",
  "values": {
    "home": "The domain model and its boundary",
    "done": "Every consumer uses one tested shape."
  }
}
```

A sequence owns exactly one of flat `items` or named `stages`; each stage owns
its nested work items. Each work item has only a globally unique `id`, a reader-facing
`title`, and values for exactly the section's fields. A sequence may omit fields
when titles alone are sufficient, but it must contain at least one work item. Its work items do not carry
records-only `view`, `provenance`, `subject`, `change`,
or `explanation` metadata. They are delivery work by definition.

At most one sequence may appear in a document. Each work item is a graph entity
addressed by its globally unique ID. Every work item must be the target of at
least one `implemented-by` relationship, and every `implemented-by` target must
resolve to a work item. Decision options add records to records sections, never
work to the sequence.

Root `depends-on` relationships between work items derive compact numbered
steps or genuine parallel phases. A flat sequence uses `items` for the common
linear case. When those phases have meaningful task-local names, use `stages`;
each stage has a stable ID, a reader-facing title, and one or more nested items.
Stage membership and authored order must exactly match the dependency-derived
phases, so stage names cannot override or contradict delivery readiness. Do not
use a named stage merely to replace "step 1" with generic ceremony. Item order
breaks ties within a phase; it does not replace dependency semantics. The
inspector can edit item titles and values without changing stable IDs or stage
membership. A stage is an authored grouping, not an entity and therefore not a
relationship endpoint. Sequence sections are not worker-refreshable because
their items, coverage, and dependencies must remain one coherent delivery graph.

## Exact-detail exhibits

An exhibits section keeps syntax, execution order, visual evidence, or a
rendered document inside the semantic graph when prose or records cells would
lose essential precision:

```jsonc
{
  "id": "migration-handoff",
  "title": "Exact migration handoff",
  "purpose": "Keep the approved command and rollout order beside the behavior they realize.",
  "kind": "exhibits",
  "provenance": "code" | "reference" | "optional",
  "items": [Exhibit]
}
```

Every exhibit has one stable graph identity:

```jsonc
ExhibitCommon = {
  "id": "globally-unique-graph-entity-id",
  "title": "reader-facing exact detail",
  "change": Change,
  "description": "optional rationale or boundary",
  "provenance": "optional source governed by the section policy"
}
```

A code exhibit stores one exact block:

```jsonc
CodeExhibit = ExhibitCommon & {
  "kind": "code",
  "language": "optional syntax language",
  "content": "non-empty exact source text"
}
```

Use it for SQL, shell commands, request or response payloads, type declarations,
configuration, or pseudocode whose exact shape matters. `content` preserves
authored whitespace, including indentation and trailing newlines. `language`
selects syntax highlighting when Toy Box bundles that language; an unknown or
omitted language renders as exact plain text. Every code block has a copy
control.

A procedure exhibit keeps ordered instructions with optional exact blocks:

```jsonc
ProcedureExhibit = ExhibitCommon & {
  "kind": "procedure",
  "steps": [{
    "id": "stable-step-id",
    "instruction": "what happens at this point",
    "code": {
      "language": "optional syntax language",
      "content": "non-empty exact source text"
    }
  }]
}
```

`steps` is non-empty and authored order is execution order. Step IDs are unique
within the procedure and remain stable while steps are edited or reordered.
Steps are not graph entities: relationships target the exhibit as a whole. Use
ordinary instructions for branches, failure handling, or rollback and attach a
code block only when exact syntax improves the handoff.

An image exhibit references one visual:

```jsonc
ImageExhibit = ExhibitCommon & {
  "kind": "image",
  "uri": "./relative/image.svg" | "https://example.com/image.png"
}
```

A relative URI resolves from the `.intent` file's directory through Toy Box's
existing file-serving base. An absolute `http` or `https` URI renders directly.
Other absolute paths and URI schemes are invalid. Images render through an
ordinary `<img>`, supporting SVG and browser-native raster formats without
copying their bytes into the intent. The exhibit title supplies its alternative
text and the optional description acts as its caption.

An HTML exhibit embeds one rendered document from exactly one source:

```jsonc
HtmlExhibit =
  | ExhibitCommon & {
      "kind": "html",
      "uri": "./relative/prototype.html" | "https://example.com/prototype"
    }
  | ExhibitCommon & {
      "kind": "html",
      "content": "<html>...</html>" | "<svg>...</svg>"
    }
```

The URI variant uses the same URI rules and file-serving base as images. Relative
documents load through Toy Box's existing `/api/serve` route; absolute `http(s)`
documents load directly. The content variant stores exact HTML or raw SVG in the
intent and renders it through the iframe's `srcdoc`. Relative references inside
that content resolve from the `.intent` file's directory. Both variants use the
same sandbox policy as the HTML file editor. Remote servers may still refuse
framing through their own security policy.

Use an image exhibit to reference an existing local or remote visual, including
an SVG file. Use an HTML exhibit when the rendered document itself belongs in the
intent, including an inline SVG, or when an HTML document or interactive
prototype must render in an iframe.

Exhibits use the same change and provenance semantics as records,
including the provenance tooltip on their change-state chip. A non-`new` exhibit
requires provenance unless the section policy is `optional`; `code` provenance
must be a workspace-relative location. The inspector can edit titles, change
state, descriptions, source, image and HTML URIs, embedded HTML or SVG content,
exact code, and procedure structure without changing the exhibit ID. The complete
form is validated before saving, and a concurrent edit to the same exhibit is
rejected.

Do not use an exhibit for ordinary rationale, a decorative example, a prose plan
wrapped in code fences, or every command an implementer might happen to run.
Delivery work and phase ordering remain in the build-order reading. Use an
exhibit only when its exact code, ordered procedure, referenced visual, or
rendered HTML must be delivered as authored.

## Relationships

Relationships connect authored entities without duplicating them:

```jsonc
EntityId = "globally unique ID of an existing graph entity"

Relation = {
  "id": "globally-unique-relation-id",
  "from": EntityId,
  "to": EntityId,
  "kind": "precedes" | "depends-on" | "causes" | "realized-by" |
          "implemented-by" | "preserves",
  "label": "optional reader-facing refinement"
}
```

Sections, records, work items, exhibits, questions, and decisions share one ID
namespace. Each entity declares its type once through its authored shape. A
reference supplies only that ID; validation resolves the entity and its type
before enforcing relationship policy.

Add a relationship only when it materially improves sequence, dependency,
causality, product-to-architecture traceability, or a preserved boundary. It is
not a substitute for the authored meaning of a record. Prefer a small connected model over
linking every nearby entity.

When architectural fit matters, choose the graph topology that actually
explains it. One task may need a path from outcome to owner to exact shape;
another may need a lifecycle, an ownership boundary, a before-and-after
comparison, or one preservation link. Do not add placeholder entities or
mechanical links to imitate a preferred topology, and do not make the graph
carry architecture the authored document never explains.

Root `relations` connect shared authored entities. A decision option may add
relationships whose endpoints are shared entities or records added by that same
option. Relations from the active provisional or decided option appear in the
task readings that select them and retain their decision status. Relationship
IDs are globally unique; endpoints must exist; self-links are invalid.

`implemented-by` is reserved for the optional delivery graph authored when the
human requests implementation work. It starts from a settled structured change,
a decision, or relevant prose/list guidance and targets an item in the native
`sequence` section. That target is a work unit. Work-unit fields remain task-defined. A concise
domain-local location such as `Where it lands` plus a concrete completion
condition such as `Done when` usually makes the derived timeline useful without
opening traceability. Add ownership, risk, or validation only when it changes
how the work can be handed off or verified.

Use root `depends-on` relations between work units to express delivery
prerequisites. Every such dependency requires a reader-facing reason, and the
work graph must be acyclic. Do not infer implementation dependencies from
runtime `precedes`, `causes`, or `realized-by` links: system order and delivery
order are distinct.

## Map sections

A map is an authored top-level section placed exactly where its topology advances
the document's reading. It projects existing entities and relationships; it
does not own or copy records:

```jsonc
MapSection =
  | {
      "id": "restart-path",
      "title": "Follow a restart reconnect",
      "purpose": "Trace durable history into the first restored prompt.",
      "kind": "map",
      "collapsed": false,
      "layout": "flow" | "network",
      "roots": [EntityId] | undefined,
      "relations": ["relationship-id"] | undefined,
      "kinds": ["precedes" | "depends-on" | "causes" |
                "realized-by" | "preserves"] | undefined
    }
  | {
      "id": "attach-routes",
      "title": "What happens when a terminal attaches",
      "purpose": "Compare live, restarted, and empty attachment paths.",
      "kind": "map",
      "collapsed": false,
      "layout": "paths",
      "paths": [MapPath],
      "regions": [MapRegion] | undefined,
      "relations": ["supporting-relationship-id"] | undefined
    }
```

```jsonc
MapPath = {
  "id": "stable-path-id",
  "title": "reader-facing route name",
  "purpose": "what this route makes easier to understand",
  "root": EntityId,
  "relations": ["relationship-id", "..."]
}

MapRegion = {
  "id": "stable-region-id",
  "title": "reader-facing place on the map",
  "entities": [EntityId]
}
```

- A staged or network map uses effective relationships other than
  `implemented-by`. `kinds` filters them, `relations` selects and orders exact
  relationship IDs, and `roots` traverses the remaining graph outward in
  authored root order. Omit all three selectors only when the complete graph is
  genuinely the useful reading. Both layouts render each endpoint once and show
  compact labeled outgoing links instead of repeating full source and target
  cards. `flow` arranges the unique nodes into outward stages; every authored
  root begins in the first stage. `network` lays that same outward stage order
  into a responsive field.
- A `paths` map is for several task-named routes, branches, merges, or feedback
  that readers should not have to reconstruct. Each path names one rooted
  directed subgraph. All its selected relationships must be reachable outward
  from its root, several paths may share relationships and entities, and the
  combined path relationships must remain acyclic. Put the route that most
  directly answers the section's question first.
- Optional path-map `relations` are supporting connections, such as a result
  feeding the next eligibility check. Both endpoints must already be placed by
  a path, and a supporting relationship cannot also be listed inside a path.
- Optional regions give exclusive task-local names to sets of path entities,
  such as "One freshness gate" or "Restart-only history." A node belongs to at
  most one region, and regions never create or copy graph content.
- Every layout places current or preserved nodes and changed or new nodes on one
  change-labeled map so a reader can understand the evolution in place. Inactive
  option relationships disappear from projected paths; a path with no reachable
  effective relationship is unavailable until its option becomes effective.

A map must earn its place by making causality, sequence, ownership, or a boundary
clearer than nearby prose. Do not add a map merely because relationships exist,
and do not repeat it as an alternate reading elsewhere.

## Saved versions and checkpoint comparison

The editor can store one compact comparison checkpoint at the root:

```jsonc
SavedVersion = {
  "savedAt": "ISO-8601 UTC timestamp",
  "items": [{
    "key": "stable typed item key",
    "kind": "intent" | "section" | "record" | "work" | "exhibit" | "question" |
            "decision" | "relationship",
    "label": "reader-facing label at save time",
    "fingerprint": "16 lowercase hexadecimal characters"
  }]
}
```

This manifest covers the opening, semantic section content (including map and
named-stage configuration but excluding current disclosure and records-view
state), records, work, exhibits, questions, decisions, and relationships, including
ownership and authored order.
It deliberately does not duplicate their content. Stable keys identify
additions and removals; fingerprints identify edits; saved labels keep removed
or renamed items understandable.

`savedVersion` is optional and editor-owned. Authors and workers must preserve
it unchanged while revising the rest of a file and must not manufacture,
refresh, or partially update its keys or fingerprints. Saving a new version is
an explicit editor action that replaces the whole manifest after validating the
current graph. Checkpoint drift is editor chrome rather than authored document
content.

## Group sections and subsections

```jsonc
{
  "id": "domain-map",
  "title": "Domain map",
  "purpose": "Place related task-specific lenses together.",
  "kind": "group",
  "layout": "stack" | "columns",
  "sections": [LeafSection]
}
```

`columns` lays out subsections as peer lenses; `stack` preserves a vertical
workflow. A group cannot contain another group. It may contain content and
workflow subsections, but a group containing questions or decisions cannot be
wholesale-refreshed because doing so could destroy investigation or human-owned
decision state. Maps are top-level sections and cannot be nested in groups.

## Questions

```jsonc
{
  "id": "questions",
  "title": "Questions",
  "purpose": "Resolve facts that can still change this board.",
  "kind": "questions",
  "items": [{
    "id": "stable-question-id",
    "question": "unsettled fact",
    "resolutionMethod": "investigate-code" | "run-experiment",
    "effect": "what board content can change depending on the answer",
    "resolution": "settled answer",
    "affects": [EntityId]
  }]
}
```

- `investigate-code` settles only what implementation can answer.
- `run-experiment` records an observable result without making a product choice.
- Clearing `resolution` reopens the question.

Resolve cheap factual questions while authoring. Every unresolved question in
every question section blocks approval. Retain a resolved question only when its
former uncertainty remains useful rationale.

## Decisions

```jsonc
{
  "id": "design-decisions",
  "title": "Design decisions",
  "purpose": "Record human-owned alternatives.",
  "kind": "decisions",
  "items": [Decision]
}

Decision = {
  "id": "stable-decision-id",
  "question": "the genuine fork",
  "options": [DecisionOption],
  "chosen": "option-id" | null,
  "status": "open" | "provisional" | "decided",
  "blocking": true | false,
  "dependsOn": ["question-id", "..."],
  "affects": [EntityId],
  "rationale": "optional durable context"
}

DecisionOption = {
  "id": "stable-option-id",
  "label": "concise option",
  "rationale": "why choose it",
  "tradeoff": "what it gives up",
  "adds": [OptionAddition],
  "relations": [Relation]
}

OptionAddition = Record & {
  "sectionId": "target-records-section-id"
}
```

An addition references any authored records section, satisfies its subject,
fields, and provenance policy exactly, and may not be `existing`. Its ID shares
the document's global graph-entity namespace.

`affects` names the existing entities whose interpretation or implementation can
change when a question is answered or a decision is recorded. It supports
contextual inspection without copying the affected records into workflow
sections.

Selecting an option makes it `provisional` and projects its additions into their
target records sections for comparison. Recording it makes the choice `decided`.
Reopening retains the explored option; clearing removes only its projection.
Projected records remain visibly attributed to their option and can never be
removed as shared content.

`adds` may be empty when the option itself is the complete decision. A decided
option's label, rationale, and tradeoff remain part of the approved intent even
without structured additions. Decided additions are implementation obligations;
provisional additions remain exploratory.

Only a human records `decided`. Independent decisions must compose in every
selectable combination. Bundle coupled axes or use factual dependencies rather
than exposing incompatible combinations.

## Readiness and execution

The board is approvable only when:

1. every question in every authored question section has a resolution; and
2. every blocking decision is `decided` with its factual dependencies resolved.

Implementation consumes the task-defined intent rather than a fixed section
inventory. Required coverage is derived from:

- every effective non-`existing` shared record;
- every non-`existing` exhibit;
- additions from decided options; and
- every decided option's label, rationale, and tradeoff.

Prose and lists remain authoritative implementation guidance and may link to
work units without becoming required coverage units. `existing` records,
unresolved non-blocking exploration, and provisional additions inform review but
are not implementation obligations.
Readiness measures settled intent, not implementation correctness.

A delivery sequence is optional authored content. It may be included when the
board is first generated or added later when the human requests implementation
work. It links every settled obligation to at least one work unit with
`implemented-by` and records only real delivery prerequisites between those
units. The sequence is complete only when:

1. at least one work unit is active;
2. every settled obligation, including each decided choice, is covered; and
3. the work-unit dependency graph is acyclic.

Completeness is not usefulness. With obligation links collapsed, the work-unit
titles, task-local fields, and genuine parallel phases must still explain where
work happens, what can proceed together, what waits, and how completion is
proved. Dependency labels remain exact graph metadata; the sequence does not
repeat them as subtitles above or inside each work card.

Changing or reopening settled intent does not silently preserve sequence validity.
Newly settled content appears as uncovered, option-owned coverage follows only
the active decided option, and work units that are no longer connected disappear
from the effective delivery sequence unless another covered unit depends on
them.

An approvable board without a sequence can start work directly from its complete
authored document. When a sequence is present, start work additionally requires
the sequence to be complete and follows its derived phases. Same-phase units are
independent by the authored dependency graph; later phases remain blocked until
their prerequisites complete.

## Global invariants

- Graph entity IDs are globally unique across sections, records, option-owned
  records, work items, exhibits, questions, and decisions.
- Procedure step IDs are unique within their exhibit.
- Choice IDs and labels are unique within one field.
- Decision dependencies reference real questions.
- Question and decision effects reference real authored entities.
- Exact code and procedure code blocks contain non-empty source text.
- Option additions reference real records sections.
- Relation IDs are globally unique, endpoints exist, and self-links are invalid.
- Map roots resolve and selected relationship IDs are not `implemented-by`.
  Path relationships are reachable from their roots, their union is acyclic,
  supporting links connect path endpoints, and region membership is valid and
  exclusive.
- Saved-version item keys are unique, timestamps are valid ISO datetimes, and
  fingerprints are exactly 16 lowercase hexadecimal characters.
- Option relationships reference only shared entities or additions owned by
  that option.
- At most one native sequence exists, every work item it owns directly or
  through a named stage is an implementation work unit, and stage IDs are unique
  within that sequence. Stages are not graph entities.
- Named stage membership and order exactly match the phases derived from
  implementation dependencies.
- `implemented-by` starts from a potential structured obligation, decision, or
  prose/list guidance section and targets a work unit in the sequence section.
- Implementation coverage edges are unique.
- A `depends-on` relation touching one implementation work unit connects two
  work units, is authored at the root, and supplies a reason.
- Implementation dependencies are unique and acyclic.
- All readiness, reference, projection, count, and transition logic traverses the
  complete authored form, including grouped subsections.
- The schema is strict. Unknown keys, retired fixed sections, incomplete values,
  invalid references, and inconsistent decision states fail at the boundary.
