# The `.intent` format

This reference is the concise authoring contract for a Toy Box
`IntentDocument`. The runtime Zod schema remains the validating source of truth;
this document describes the exact persisted shape and semantics an author needs.
The file is strict JSON: unknown fields, incomplete values, invalid references,
and inconsistent decision state are rejected.

Findings preserve settled facts that shape a change. Description, definition,
and resolution sections form the effective spec. Zero or more top-level plan
sections collectively form one optional plan. These are derived roles, not
stored wrappers or mandatory layouts.

## Contents

- [Notation and minimum document](#notation-and-minimum-document)
- [Document tabs](#document-tabs)
- [Sections and semantic roles](#sections-and-semantic-roles)
- [Shared values and references](#shared-values-and-references)
- [Findings](#findings)
- [Markdown and lists](#markdown-and-lists)
- [Fields and records](#fields-and-records)
- [Exhibits](#exhibits)
- [Questions](#questions)
- [Decisions](#decisions)
- [Derived spec](#derived-spec)
- [Document-wide rules](#document-wide-rules)

## Notation and minimum document

JSONC blocks use `| undefined` to mean that the property may be omitted; never
write the literal value `undefined`. A “defaults to” comment means omission is
valid and parsing supplies that value. `[T, "..."]` means one or more entries;
`[T, T, "..."]` means at least two. Every string shown as semantic content must
be non-empty after trimming unless the reference explicitly says its whitespace
is preserved. `EntityId` denotes a globally unique intent entity ID.

The smallest useful document can be one Markdown section:

```json
{
  "title": "Let copied links reopen the same message",
  "sections": [
    {
      "id": "outcome",
      "title": "What changes",
      "purpose": "Define the behavior a copied message link must preserve.",
      "kind": "markdown",
      "body": "A copied link reopens the same session and focuses the referenced message."
    }
  ]
}
```

The root shape is:

```jsonc
{
  "title": "concise document headline",
  "sections": [Section, "..."],
  "tabs": [Tab, Tab, "..."] | undefined
}
```

`sections` order is canonical. The root has no entity ID; the containing file
supplies document identity. Put opening explanation in an ordinary task-named
Markdown section when the title is not enough.

## Document tabs

Tabs optionally partition top-level sections into distinct reading surfaces:

```jsonc
Tab = {
  "title": "unique reader-facing title",
  "sections": ["top-level-section-id", "..."]
}
```

When `tabs` exists, its titles are unique. Every top-level section appears in
exactly one tab; unknown, repeated, or missing section references are invalid.
Tabs own no IDs and do not change root section order, reference scope, spec
state, plan state, or worker context.

Omit tabs for one continuous document. Execution may add an `Execution results`
surface beside the intent that authorized it.

## Sections and semantic roles

Every section shares:

```jsonc
SectionCommon = {
  "id": EntityId,
  "title": "reader-facing heading",
  "purpose": "why this section exists",
  "collapsed": false // optional; defaults to false
}
```

`purpose` is durable authoring guidance exposed on demand, not a subtitle. It
should add interpretation rather than repeat the title or visible content.

| Role        | Section kinds            | Contribution                                          |
| ----------- | ------------------------ | ----------------------------------------------------- |
| Grounding   | `findings`               | Established facts that shape but do not join the spec |
| Description | `markdown`, `list`       | Literal spec guidance                                 |
| Definition  | `records`, `exhibits`    | Addressable requirements or authoritative context     |
| Resolution  | `questions`, `decisions` | Unknown facts and human-owned choices                 |
| Execution   | `plan`                   | Ordered work implementing the derived spec            |

Exhibit shapes are defined in the [exhibit contract](#exhibits) below; read
[plan.md](plan.md) for plan shapes and execution state.

Authored order is meaningful for sections, fields, records, options, list items,
and plan work. Do not sort them globally.

## Shared values and references

### Markdown text

Markdown bodies, list items, finding consequences, and exhibit descriptions use
ordinary Markdown rendered by Toy Box.

### Change

```text
Change = existing | new | modified | removed | preserved |
         renamed | split | relocated
```

- `existing` is adjacent context and not a requirement.
- `new`, `modified`, `removed`, `renamed`, `split`, and `relocated` define target
  change.
- `preserved` is an existing behavior, structure, or boundary the change must
  explicitly retain.

### Source policy

Findings, records, and exhibits sections declare one section-local policy:

```text
SourcePolicy = code | reference | optional
```

- `code` requires workspace-relative paths with an optional `#Symbol` wherever
  that section requires a source.
- `reference` accepts a non-empty task-relevant location such as a URL, document
  anchor, trace, dataset, or code location.
- `optional` permits omission.

Under `code` or `reference`, every finding and every non-`new` record requires a
source. A supplied source on a `new` record still obeys that format. Exhibit
source rules vary by authoritative owner and are defined in
[Exhibit ownership](#exhibit-ownership).

### Identity and grounding

Intent entity IDs are globally unique across sections, findings, finding
exhibits, records, decision additions, section- and option-owned exhibits,
questions, decisions, and plan steps. IDs are durable reference identity;
reader-facing labels may change.

Records, spec exhibits, and decisions may own:

```jsonc
"basedOn": ["finding-id", "..."] | undefined
```

The array is unique and resolves only to findings. It means those facts
materially explain the entity's shape; it never turns a finding into a
requirement. Removing a finding removes affected grounding links in the same
valid rewrite.

Question and decision `affects`, decision `dependsOn`, flow path and region
references, tabs, `basedOn`, and many-choice values reject duplicates.

## Findings

```jsonc
FindingsSection = SectionCommon & {
  "kind": "findings",
  "sourcePolicy": SourcePolicy,
  "items": [Finding, "..."]
}

Finding = {
  "id": EntityId,
  "statement": "one concise established fact",
  "whyItMatters": "optional Markdown consequence" | undefined,
  "sources": ["unique source", "..."] | undefined,
  "exhibit": Exhibit | undefined
}
```

`whyItMatters` is optional because an obvious consequence needs no restatement.

A finding may own one supporting exhibit when structured evidence communicates
existing reality better than prose. Its shape and owner-specific semantics
follow the [exhibit contract](#exhibits) below. The finding itself remains
inspectable and may ground spec entities.

Questions hold facts that remain unknown; findings hold facts already
established. There is no derived research state because the document cannot
infer whether investigation found every relevant fact.

## Markdown and lists

```jsonc
MarkdownSection = SectionCommon & {
  "kind": "markdown",
  "body": "non-empty Markdown"
}

ListSection = SectionCommon & {
  "kind": "list",
  "style": "bullet" | "ordered", // optional; defaults to "bullet"
  "items": ["unique non-empty Markdown item", "..."]
}
```

Both section kinds are addressable spec guidance, not derived requirements.

## Fields and records

### Fields

```jsonc
Field =
  | {
      "id": "stable field ID",
      "label": "reader-facing label",
      "kind": "text"
    }
  | {
      "id": "stable field ID",
      "label": "reader-facing label",
      "kind": "choice",
      "cardinality": "one" | "many",
      "options": [{
        "id": "stable option ID",
        "label": "reader-facing value",
        "description": "optional clarification" | undefined
      }, "..."]
    }
```

Within one records or plan section, field IDs and column labels are unique.
Choice option IDs and labels are unique within their field. A records section's
subject label participates in column-label uniqueness.

Text values are one non-empty string. A single-choice value is one declared
option ID. A many-choice value is a non-empty, duplicate-free array of declared
option IDs.

### Records

```jsonc
RecordsSection = SectionCommon & {
  "kind": "records",
  "view": "table" | "cards",
  "sourcePolicy": SourcePolicy,
  "subject": "optional identity-column label" | undefined,
  "fields": [Field, "..."], // optional; defaults to []
  "items": [Record, "..."] // optional; defaults to []
}

Record = {
  "id": EntityId,
  "subject": "record identity" | undefined,
  "change": Change,
  "values": { "field-id": "value or value array" },
  "source": "source governed by section policy" | undefined,
  "explanation": "optional progressive context" | undefined,
  "basedOn": ["finding-id", "..."] | undefined
}
```

A records section declares a subject or at least one field. A record supplies
`subject` exactly when its section declares one, and `values` contains exactly
the section's field IDs with values of the declared kinds.

`table` supports field-by-field comparison; `cards` supports independently
inspectable concepts. `explanation` adds rationale, boundaries, examples, or
implications without creating or changing a requirement. It may not conceal
another record, source, plan, or alternative.

Effective non-`existing` records are derived requirements. A proposal not yet
accepted belongs in a decision option rather than another status axis.

## Exhibits

Exhibits preserve an authoritative definition, topology, hierarchy, visual
evidence, or rendered document. Each should own one coherent contract whose form
materially constrains what reviewers understand or agree to.

### Section and common fields

```jsonc
ExhibitsSection = SectionCommon & {
  "kind": "exhibits",
  "sourcePolicy": SourcePolicy,
  "items": [Exhibit, "..."]
}

ExhibitCommon = {
  "id": EntityId,
  "title": "reader-facing definition",
  "change": Change,
  "description": "optional Markdown rationale or boundary" | undefined,
  "source": "source governed by the section policy" | undefined,
  "basedOn": ["finding-id", "..."] | undefined
}
```

`Change`, global identity, and `basedOn` use the shared rules above.

### Exhibit ownership

An exhibit's authoritative owner determines its source, grounding, and
activation:

| Owner            | Source and grounding                                                                                                | Semantic role                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Exhibits section | Its section policy governs `source`; `basedOn` may identify material findings.                                      | `existing` is context; every other change is one derived requirement.                                                   |
| Finding          | It may rely on the finding's sources; a supplied source follows the finding section's policy; `basedOn` is invalid. | It must be `existing` and remains local evidence, not an independent requirement.                                       |
| Decision option  | `source` is optional with no section policy; `basedOn` may identify material findings.                              | It cannot be `existing`; it remains visible but conditional until the option is decided, when it becomes a requirement. |

References target the complete exhibit; only shared entities used by a flow
retain independent identity.

### Pseudocode

```jsonc
PseudocodeExhibit = ExhibitCommon & {
  "kind": "pseudocode",
  "language": "optional syntax language" | undefined,
  "content": "non-empty exact content"
}
```

Use pseudocode for an interface, type, schema, request or response contract,
configuration shape, signature, protocol, or algorithm whose structure belongs
in the spec without claiming to be production source. `content` preserves
authored whitespace, including indentation and trailing newlines. An unknown or
omitted language renders as plain text.

### Flows

A flow owns one authoritative directed topology. It may reuse shared intent
entities without copying them and may add local waypoints whose meaning exists
only inside the flow.

```jsonc
FlowNode =
  | { "entity": "shared intent entity ID" }
  | {
      "id": "node ID unique within this flow",
      "title": "reader-facing waypoint",
      "description": "optional Markdown detail" | undefined,
      "change": Change | undefined
    }

FlowConnection = {
  "id": "connection ID unique within this flow",
  "from": "flow node ID",
  "to": "flow node ID",
  "label": "reader-facing directed verb phrase"
}

FlowPath = {
  "id": "path ID unique within this flow",
  "title": "reader-facing route name",
  "purpose": "what this route makes easier to understand",
  "start": "flow node ID",
  "connectionIds": ["owned connection ID", "..."]
}

FlowRegion = {
  "id": "region ID unique within this flow",
  "title": "reader-facing place",
  "nodeIds": ["path-placed node ID", "..."]
}

FlowExhibit = ExhibitCommon & {
  "kind": "flow",
  "nodes": [FlowNode, FlowNode, "..."],
  "connections": [FlowConnection, "..."],
  "paths": [FlowPath, "..."],
  "regions": [FlowRegion, "..."] | undefined
}
```

#### Shared and local nodes

A shared node may reference a Markdown or list section, record, non-flow spec
exhibit, question, decision, decision-option addition, or non-flow option
exhibit. Its label, detail, and change come from that entity. A flow cannot
reference itself. Groups, collection sections, plans, and plan steps are
invalid shared nodes. Shared nodes in an option-owned flow may use only shared
spec entities and contributions from that same option.

A local node carries its own ID and presentation. It remains inspectable through
the flow but is not a document-wide entity, relationship endpoint, or plan
target. Shared and local node identities must be unique within the flow.

#### Connections and paths

Every node participates in a connection. Connection endpoints resolve to owned
nodes, self-links are invalid, and IDs are unique within the flow.

Each path selects owned connections and starts at a node from which all selected
connections are reachable outward. Paths may branch, merge, and share
connections, but the union of all path connections is acyclic. Author the route
that best answers the exhibit's question first because the renderer opens on
the first path.

A connection omitted from every path is supporting context. Both endpoints
must already be placed by a path. A region contains path-placed nodes; region
IDs are unique and a node can belong to at most one region.

The renderer offers each named path and a Whole flow view over the same graph.
There is no alternate network model or document-wide relationship array. A
flow's connections are visual topology owned by that exhibit, not decision
consequences or execution order.

#### Requirement identity

A non-`existing` section-owned flow is one coherent spec requirement; an
option-owned flow becomes one only when its option is decided. Shared
non-`existing` records and exhibits used as nodes retain their own activation
and requirement identity. Local nodes, connections, paths, and regions do not.

### Trees

A tree specifies one or more required hierarchies. Its `type` selects
file-system or domain containment.

```jsonc
TreeChange = "new" | "modified" | "removed"

FileTreeEntry =
  | {
      "kind": "file",
      "name": "file name or root path",
      "change": TreeChange | undefined
    }
  | {
      "kind": "folder",
      "name": "folder name or root path",
      "change": TreeChange | undefined,
      "children": [FileTreeEntry, "..."] // optional; defaults to []
    }

DomainTreeEntry = {
  "name": "domain concept",
  "change": TreeChange | undefined,
  "children": [DomainTreeEntry, "..."] | undefined
}

TreeExhibit =
  | ExhibitCommon & {
      "kind": "tree",
      "type": "files",
      "roots": [FileTreeEntry, "..."]
    }
  | ExhibitCommon & {
      "kind": "tree",
      "type": "domain",
      "roots": [DomainTreeEntry, "..."]
    }
```

Use multiple roots instead of inventing a meaningless shared ancestor. Names
are unique among siblings. Only a file-tree folder owns children. A domain tree
models conceptual containment without programming-type semantics. Use a flow
when directed cross-cutting connections or traversal carry the meaning.

Missing node `change` means unchanged context. Tree entries are local values;
flows, decisions, and plans target the tree exhibit as a whole.

### Images

```jsonc
ImageExhibit = ExhibitCommon & {
  "kind": "image",
  "uri": "./relative/image.svg" | "https://example.com/image.png",
  "altText": "the information conveyed by the image"
}
```

A relative URI resolves from the intent file's directory. An absolute URI must
use `http` or `https`; absolute filesystem paths, backslashes, and other schemes
are invalid. `altText` is required and conveys the visual meaning independently
of the title. Use `description` as an optional caption.

### HTML

```jsonc
HtmlExhibit =
  | ExhibitCommon & {
      "kind": "html",
      "uri": "./relative/prototype.html" | "https://example.com/prototype"
    }
  | ExhibitCommon & {
      "kind": "html",
      "content": "non-empty HTML or raw SVG"
    }
```

Supply exactly one of `uri` or `content`. Use embedded content when the intent
owns a new prototype or rendered definition; use a URI when an existing local
or remote document remains authoritative. URI rules match images. Relative
resources inside embedded content resolve from the intent file's directory.
Both variants render through Toy Box's sandboxed HTML boundary, and remote
servers may still refuse framing.

Use an image for a referenced visual, including an SVG file. Use HTML when the
rendered document itself belongs in the intent, including embedded SVG, or when
an interactive document must render in an iframe.

## Questions

```jsonc
QuestionsSection = SectionCommon & {
  "kind": "questions",
  "items": [Question, "..."]
}

Question = {
  "id": EntityId,
  "question": "unsettled fact",
  "answerMethod": "investigate-code" | "run-experiment",
  "impact": "what can change depending on the answer" | undefined,
  "affects": [EntityId, "..."], // optional; defaults to []
  "answer": "settled factual answer" | undefined
}
```

`investigate-code` settles only what implementation can establish;
`run-experiment` records an observable result without making a product choice.
Clearing `answer` reopens the question.

`affects` references shared spec entities whose interpretation can change. It
cannot target collection sections, plans, or plan steps.

## Decisions

```jsonc
DecisionsSection = SectionCommon & {
  "kind": "decisions",
  "items": [Decision, "..."]
}

Decision = {
  "id": EntityId,
  "question": "genuine human-owned fork",
  "options": [DecisionOption, DecisionOption, "..."],
  "choice": {
    "optionId": "option ID",
    "status": "provisional" | "decided"
  } | undefined,
  "dependsOn": ["question-id", "..."], // optional; defaults to []
  "affects": [EntityId, "..."], // optional; defaults to []
  "rationale": "optional durable context" | undefined,
  "basedOn": ["finding-id", "..."] | undefined
}

DecisionOption = {
  "id": "stable option ID",
  "label": "concise option",
  "rationale": "why choose it" | undefined,
  "tradeoff": "what it gives up" | undefined,
  "adds": [OptionAddition, "..."], // optional; defaults to []
  "exhibit": Exhibit | undefined,
  "relationships": [OptionRelationship, "..."] | undefined
}

OptionAddition = Record & {
  "sectionId": "target records-section ID"
}
```

Option IDs and labels are unique. Omit `choice` while open. Selecting creates a
provisional choice and projects its additions; recording makes it decided.
Reopening retains the explored option, while clearing removes its projection.
Only a human records `decided`.

An addition targets an authored records section and satisfies that section's
subject, fields, values, and source policy exactly. It cannot be `existing`; its
ID shares the document's global entity namespace.

Decided additions and the selected option exhibit become requirements, while
provisional contributions remain exploratory. When a decided option owns
neither additions nor an exhibit, the decision itself becomes the requirement.

`dependsOn` contains answered questions required before a choice can be
recorded. `affects` follows the same endpoint rules as questions. Independent
decisions must compose in every selectable combination; bundle coupled axes or
use factual dependencies rather than authoring incompatible combinations.

### Option-specific relationships

```jsonc
OptionRelationship = {
  "id": "relationship ID unique across all decision options",
  "from": EntityId,
  "to": EntityId,
  "kind": "precedes" | "depends-on" | "causes" | "realized-by" | "preserves",
  "label": "optional reader-facing refinement" | undefined
}
```

Omit `relationships` when none exist. Endpoints resolve to Markdown/list
sections, records, section-owned exhibits, questions, decisions, additions
owned by that same option, or that option's exhibit. They cannot be self-links,
findings or finding exhibits, collection or plan containers, plan steps,
flow-local values, or contributions from another option. An option-owned flow
follows the same boundary for shared nodes. These relationships express
option-specific consequences; they are not a document-wide graph, flow input,
or plan ordering.

## Derived spec

The effective spec is the document reading formed by description, definition,
and resolution sections. There is no stored spec wrapper. `SpecState` is the
smaller operational projection used for settlement and planning:

- `guidance` contains Markdown and list section entities;
- `requirements` contains effective non-`existing` records and section-owned
  exhibits, additions and exhibits from decided options, and decided
  self-contained choices;
- `openQuestions` contains every unanswered question;
- `unresolvedDecisions` contains every decision without a decided choice; and
- `settled` is true only when both blocker collections are empty.

Findings and their local evidence remain grounding, not requirements. Existing
records and exhibits and provisional option contributions may provide context
without becoming requirements. Review is the human activity that settles the
spec, not another stored state.

Read [plan.md](plan.md) when the document has or needs a plan. That reference
defines eligible implementation targets, coverage, status, and executability.

## Document-wide rules

- Resolve every reference at parse time, including inactive decision options.
- Preserve globally unique intent entity IDs and the separate document-wide
  decision-relationship ID namespace. Exhibit- and plan-local IDs follow their
  owning references.
- Traverse the complete document for identity, grounding, references, derived
  spec, plan coverage, counts, and repair.
- Preserve authored order and shared presentation state unless the requested
  revision intentionally changes them.
- Repair every affected reference in the same rewrite; never expose an
  intermediate invalid document.
- The runtime parser is strict. Unknown keys are not compatibility data and are
  never silently retained.
