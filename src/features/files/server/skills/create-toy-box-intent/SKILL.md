---
name: create-toy-box-intent
description: Create, revise, or validate strict Toy Box `.intent` documents, especially when a consequential change benefits from source-grounded findings, explicit decisions, multimodal exhibits, or an executable plan; perform focused editor actions. Follow applicable repository and agent-harness guidance for investigation, design review, and planning; this skill owns how their results are represented and related. Use `execute-toy-box-intent` for implementation or completed-outcome review.
---

# Author Toy Box Intent Documents

Use an intent to help a reader form a strong mental model of a consequential
change with the least effort compatible with sound review. Treat reader
attention as scarce: elevate the key facts, outcomes, choices, relationships,
and consequences, and require every section to earn its place by adding
necessary understanding or making that understanding materially easier to
acquire. Preserve every detail needed for review, but reveal supporting depth
progressively, minimize competing restatements, and use structured or visual
storytelling when it communicates an important idea more clearly than flat
Markdown alone.

The `.intent` file is durable authored truth: findings ground the change,
flexible sections form a reviewable effective spec, and optional plan sections
make that spec executable.

## Respect the workflow boundary

Follow applicable repository and agent-harness instructions and skills for
investigation, architecture review, validation, and implementation planning.
Use those workflows before encoding their results. This skill does not replace,
narrow, or prescribe them.

This skill owns representation and document validity. It determines how
established evidence becomes findings, desired outcomes become spec content,
genuine pivots remain questions or decisions, and planner output becomes an
executable Intent plan.

## What makes a great intent

Treat an intent as a readable document first and a semantic model second.
A teammate should understand the central change from its title and open sections
without opening an inspector, following provenance, or learning Intent's
ontology.

Find the task's natural reading shape. It may be a lifecycle, comparison,
decision, causal or ownership flow, investigation around evidence and
uncertainty, exact interface handoff, or a task-specific combination. These are
possibilities, not a template. Order sections for the reader's narrative rather
than mirroring how the material was discovered or how its entities depend on one
another. Do not manufacture standard beats such as current state, future state,
architecture, and requirements; keep the task's actual journey, alternatives,
topology, or boundary easy to follow.

Speak the task's language. Name sections, fields, records, and choices with the
terms the team already uses, and use the same noun for the same concept
throughout. When architecture matters, name the actual source of truth,
lifecycle owner, boundary, reused path, or new seam instead of vague actors such
as "the system." Keep schema vocabulary in the JSON unless the team genuinely
uses it, and prefer direct teammate language over specification voice.

Use progressive disclosure for depth, not missing context. Keep the high-signal
reasoning in open sections. Collapse supporting evidence and detail; use
provenance and inspectors for precision that would interrupt the primary
reading. Nothing essential may exist only in a deeper surface.

### Prefer clarity over ceremony

Start with the shortest natural explanation of the change, then introduce
structure only where it improves understanding. Add a section only when it
sharpens context, defines an outcome, exposes uncertainty, distinguishes a real
option, or closes meaningful scope. Prefer a paragraph or short list until
comparison, independent identity, or authored form earns a richer primitive. If
a record reads like a sentence split across generic cells, write the sentence.
When records do earn a place, keep each independently reviewable without
splitting one coherent outcome into a record per clause.

## Read the format and choose the workflow

Apply the framing above, then read the exact contracts before authoring:

- Always read [references/schema.md](references/schema.md) completely for the
  document vocabulary, exhibit forms, identity, grounding, decisions,
  references, and derived spec.
- When `metadata.intent.action` names `regenerate-section`,
  `investigate-question`, or `explain-record`, also read
  [references/editor-actions.md](references/editor-actions.md) and perform only
  that focused workflow. It replaces the ordinary authoring path below while
  retaining the same quality bar.
- Read [references/plan.md](references/plan.md) when a plan is requested or
  present, or when a revision can affect implementation coverage.
- Read [references/example.intent](references/example.intent) only when the
  contracts leave an exact cross-reference or composition ambiguous. It is an
  example, not a template.

For ordinary creation or revision, continue through representation, capture,
comprehension editing, optional planning, and validation in that order.

## Perform a representation pass

Use the full schema vocabulary before choosing final sections. Ask whether the
reader would otherwise have to reconstruct any important shape:

- type or interface evolution, payloads, schemas, protocols, or algorithms
  suggest pseudocode;
- a workflow, control or data flow, causal path, route, ownership transfer, or
  handoff suggests a flow;
- file or domain containment suggests a tree;
- visual evidence suggests an image;
- rendered interfaces, interactions, or spatial behavior suggest a prototype;
- comparable entities suggest records.

Use Markdown or an ordered list for normative behavior that remains clearest as
language. Use an exhibit only when its form constrains the outcome or materially
lowers reconstruction cost; use ordinary prose when none does. A flow
communicates directed topology rather than a numbered prose timeline or
execution plan.

## Capture the result

Lead with the intended outcome unless a finding overturns the obvious framing.

- Capture only established, load-bearing facts as findings. Cite the evidence
  that establishes each fact; keep proposals out of findings.
- Express desired behavior as direct guidance or addressable requirements
  according to whether it needs independent identity, grounding, or plan
  coverage.
- Preserve unresolved facts as questions and human-owned choices as decisions.
  Never silently turn evidence, uncertainty, or a convenient implementation
  choice into settled product behavior.
- When alternatives differ structurally or visually, attach one exhibit to each
  relevant decision option so reviewers can compare the candidates before
  choosing. Do not place mutually exclusive candidates in an unconditional
  exhibits section.
- Give mandatory independently plan-targeted outcomes identity through records,
  requirement-bearing exhibits, or settled self-contained decisions. Use
  `basedOn` only when a finding materially explains that entity's shape.
- Give each relationship one authoritative owner: findings ground spec
  entities, decision options own option-specific records, exhibits, and
  consequences, flows own visual connections, and plan steps own implementation
  links.

## Edit for comprehension

Before planning or saving, reread the complete spec as a reviewer. Give each
authored surface a distinct role in the reader's mental model. Consolidate
competing statements into one authoritative home; use references or brief
signposts for orientation, and retain overlap only when it improves local
understanding or adds evidence, comparison, consequence, or execution context.
Do not add structure merely because the schema permits it.

## Encode a requested plan

Let repository and agent-harness planning guidance determine decomposition,
order, validation strategy, and implementation detail. Encode that resulting
work with the Intent plan contract.

Every plan step must have a falsifiable completion criterion, implement at least
one eligible current spec entity, and collectively cover every current
requirement. Use phases only as named grouping and preserve unresolved choices
instead of manufacturing an executable plan.

## Validate and write

Before saving, confirm that:

- every finding is supported by its sources and every material requested
  outcome, non-goal, unknown, and choice is captured;
- the title and open sections communicate the change in the team's language
  without relying on inspectors, and each material meaning has one authoritative
  home;
- every reference resolves and decision state is internally consistent; and
- any plan covers the derived current spec without treating findings as targets.

On revision, preserve disclosure, records views, tab membership, human choices
and answers, and plan status unless the request changes them. Repair all
affected references in the same rewrite. Validate the complete JSON, write it
to a concise `.intent` path in the current session's files folder, and never
call `open_file`; Toy Box surfaces it automatically.
