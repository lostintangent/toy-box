---
name: create-toy-box-intent
description: Create, revise, or review task-defined Toy Box `.intent` forms that compose concise sections, workflow, relationships, inline maps, and delivery sequences for consequential changes.
---

# Author Toy Box Intent Forms

An intent is the upstream counterpart to a code review: a compact,
code-grounded or otherwise provenance-grounded definition of what should change
and why. The `.intent` file is durable truth; Toy Box supplies reusable review
primitives without prescribing one specification shape.

Do not inspect Toy Box source to discover the format. Read
[references/schema.md](references/schema.md) completely; it is authoritative.
Use [references/example.intent](references/example.intent) as one worked form,
not a template every board should resemble.

This file owns the authoring workflow and worker actions. The schema reference
owns JSON shape, field semantics, and validity rules. If they disagree, the
schema reference wins.

## When an intent earns its ceremony

Use an intent when a change is consequential, has genuine alternatives, spans
several surfaces, needs non-author alignment, or could be implemented correctly
while still solving the wrong problem. For a local or obvious edit, use a plan
or diff instead. Make this judgment before broad investigation.

## Minimum sufficient form

An intent is a readable document first and a semantic graph second. A teammate
should be able to understand the change by reading the authored sections from
top to bottom without opening an inspector, source, or explanation.

- The title is the only required opening. Do not add an introductory paragraph by
  default. If prose earns a place, put it in a task-named prose section; if
  the first structured section gets to the point faster, start there.
- Start with the shortest natural explanation of the change. Two to four
  conversational sections are a healthy default, not a quota.
- Prefer prose or a short list until repeated fields make comparison materially
  easier. A records section must earn the extra visual and cognitive
  structure.
- Add a section only when it sharpens context, defines an outcome, exposes
  uncertainty, distinguishes a real option, or closes meaningful scope.
- Choose the natural primitive. Do not force prose into a table, a matrix into
  cards, or task-specific concepts into Domain/Product headings.
- Do not inventory every surface, owner, layer, noun, verb, or invariant merely
  because the schema can represent it. Include the few distinctions that change
  understanding or a decision.
- Do not create generic fields named Requirement, Behavior, Role, Owner, or
  Surfaces by default. Use them only when people actually need to compare those
  values across several records. If a row reads like a sentence broken across
  cells, write the sentence.
- Add code, procedure, image, or HTML exhibits only when exact syntax, execution
  order, visual evidence, or a rendered document materially changes what
  reviewers understand or agree to. A decorative sample or code-fenced
  restatement of prose does not earn another section.
- Use relationships only when a task-named map section communicates sequence,
  dependency, causality, realization, or preservation more clearly than prose.
- Keep the form focused on intent. Include implementation work only when the
  human requests it, whether in the initial request or a later revision.
- Treat counts as outcomes, never targets.
- Before writing, remove every field, record, sentence, and section that can
  disappear without changing what must be built, learned, chosen, preserved, or
  excluded.
- Compare the first read with a short Markdown note. If Markdown is easier to
  follow, the form is over-modeled: simplify it before adding more structure.

## Find this task's natural reading shape

Coherence is required; a standard plot is not. Start by asking what arrangement
would make this particular change easiest to understand. Its natural shape might
be:

- a journey through a lifecycle or user experience;
- a comparison of a small finite policy;
- a decision organized around genuine alternatives;
- a causal flow from trigger to consequence;
- an ownership or data topology;
- an investigation organized around evidence and uncertainty;
- an exact handoff organized around a type, payload, command, or procedure; or
- a task-specific combination that has no useful generic name.

These are possibilities, not a menu to fill or a hidden section template. Most
forms should use only a few. Let the domain determine the nodes, authored order,
relationships, and useful projections. Do not add "current state", "future
state", "architecture", "requirements", or any other beat merely because it
often appears in change documents.

The graph should preserve the task's real topology. A comparison should remain
comparable, a lifecycle should remain traversable, a decision should project its
consequences, and an ownership change should make the relevant boundary clear.
The first read succeeds when a teammate can explain the central change in the
task's own terms without mentally translating a generic framework.

## Use progressive disclosure without prescribing a workflow

Open sections form the primary reading in whatever order this task needs.
Collapsed sections, inline maps, inspectors, and provenance are optional ways
to add depth:

- Collapse supporting material when it matters but should not interrupt the
  primary reasoning path.
- Use a map section only when a task-named projection of the same entities
  reveals causality, sequence, ownership, or a boundary more clearly than prose.
- Use inspection and provenance for exact records, rationale, sources, and
  editing that would otherwise break the reading flow.

No task must populate every level or section kind. Nothing essential may exist
only in a deeper surface, and a deeper surface that merely repeats the primary
reading in denser language should be removed.

## Speak the task's language

The schema has a technical vocabulary; the board should not sound like it.

- Name sections, fields, records, and choices with words the people doing this
  work already use. Prefer "What gets copied", "What survives a restart",
  "Where rendering lives", "How we'll build it", or "Leave alone" over generic
  headings such as Domain impact, Product impact, System fit, Delivery
  requirements, or Implementation work.
- Use the same domain noun for the same thing everywhere. Do not rename a
  familiar concept merely to fit a generic field or section pattern.
- Name the real architectural actors when they matter: the current source of
  truth, lifecycle owner, reused path, new seam, and preserved neighbor. Do not
  flatten them into vague words such as "system", "service", or "architecture".
- Keep headings conversational and specific. A teammate should understand the
  board's visible language without knowing Intent's section algebra, coverage
  model, relation kinds, or decision statuses.
- Write purposes, record subjects, field values, and relationship labels as
  ordinary teammate language. Avoid specification voice such as "Define...",
  "Ensure...", "The system shall...", or noun-heavy headings when a direct
  sentence is clearer.
- Keep each section internally readable. A reader should not need to mentally
  join a subject, a generic "Requirement" cell, three metadata badges, and an
  inspector to discover one behavior.
- Apply a read-aloud test before saving: if a heading, field, or fixed phrase
  sounds like platform ontology rather than this task, rewrite it in local
  terms.
- Keep schema terms such as `provisional`, `implemented-by`, and
  work-unit dependency direction in the JSON model where they provide precision;
  do not echo them into reader-facing copy unless the team genuinely uses them.

## Author or revise an intent

1. **Name the change**
   - Read the relevant subsystem guides and sources before drafting claims.
   - When architecture materially affects the request, find the relevant home:
     where the behavior or durable truth lives, which lifecycle owns it, and
     which callers or consumers make the limitation visible. Do not force an
     architecture frame onto a task that does not need one.
   - Write a concise title. Put useful opening prose in an ordinary task-named
     prose section, or let the first structured section begin when it is clearer.
   - Prose bodies are Markdown. Bridge the result naturally from the gap and use
     formatting and links where they make the passage easier to understand.

2. **Design the task-specific form**
   - Tell the change first in the shortest free-form note that makes it clear.
     Notice whether the task naturally reads as a journey, comparison, decision,
     topology, causal flow, exact handoff, or something more specific before
     choosing section primitives.
   - Identify the smallest places where structure improves that note before
     choosing section types.
   - Use `prose` for cohesive Markdown, `list` for simple unannotated entries,
     `records` for records that need fields, change labels, provenance, or
     explanations, `sequence` for requested implementation work, `exhibits` for
     exact code, ordered procedures, referenced visuals, or rendered HTML, `map`
     for a relationship topology that advances the story, and `group` for peer
     subsections that belong together.
   - Use a records table only when readers genuinely compare the same fields
     across several records. Use cards for a small set of independently
     inspectable ideas. Set the authored `view` to the best first reading; the
     editor lets readers switch it and persists their choice. Reserve the native
     sequence section for implementation work the human requested. Use a
     group only when its children are easier to understand together than as
     ordinary neighboring sections.
   - Give every section an exact `purpose`. It is durable guidance for workers
     and appears on demand from the section title's info control, not as another
     paragraph in the reading flow. It should explain why the section exists
     without restating its title or content.
   - Treat the complete authored document as the intent. Effective non-`existing`
     records and exhibits plus decided choices become structured implementation
     obligations; prose and lists remain authoritative guidance without another
     per-section truth flag.
   - Pick each records or exhibit section's provenance policy honestly:
     workspace code, task-relevant references, or optional grounding.
   - Design the first viewport: keep the primary outcome and live choices open,
     and collapse supporting architecture, provenance-heavy detail, or
     non-goals when readers can safely disclose them later.
   - Order open sections by the task's natural reasoning path, not by
     product/architecture/implementation categories. That path may be
     chronological, comparative, causal, spatial, decision-centered, or bespoke.
   - When a map explains a change, put it inline at the point where its topology
     resolves the surrounding reading. Include only the current or preserved
     entities needed to understand the changed and new entities on that map.
     Do not split them into generic before/after diagrams.
   - Use a rooted path map when the reader otherwise has to reconstruct
     several meaningful routes, a branch, a merge, or a feedback loop. Give each
     path the name and one-line consequence people use in this task. Author the
     route that best answers the section's question first so the map opens on its
     primary story rather than a setup or preserved edge case. Keep a simple
     flow or network map when one traversal already answers the question;
     paths are not decorative navigation.

3. **Investigate before choosing**
   - Inventory conflicting evidence, unverified behavior, assumed architecture,
     and proposed content presented as fact.
   - When architectural fit is material, trace the current behavior only far
     enough to identify the owners, sources of truth, lifecycle, ingress, or
     consumers that actually change understanding. Then identify the smallest
     architectural evolution that can own the request.
   - Resolve cheap factual questions while authoring. Leave only uncertainty
     that can change the form, its records, or a real design choice.
   - Convert preferences into decisions and negative feasibility findings into
     grounded records plus an honest decision about the response.

4. **Populate review content**
   - Define the smallest exact field set for each records section. Use text for
     open-ended detail and single- or many-choice fields only for a finite
     vocabulary the task genuinely needs.
   - Use `existing` only for adjacent context needed to understand target
     records. Use `preserved` for obligations, not generic unaffected-system
     inventories.
   - Ground records according to their records section's provenance policy.
   - When the task depends on architectural fit, represent only the distinctions
     that change understanding: what remains authoritative, what changes
     responsibility, what new seam or state appears, or what must not become
     coupled. Do not inventory every layer or call site.
   - Keep records atomic enough that a reviewer can accept or reject one outcome
     without silently accepting another, but do not fragment one coherent idea
     into a record per clause.
   - Keep explanations progressive. Never hide another record, evidence source,
     implementation step, or alternative inside one.
   - Keep Markdown tables and fenced code in prose only when they are incidental
     to the passage. If table rows need comparison, inspection, provenance, or
     relationships, use a records section. If code must be exact, independently
     referenced, or delivered as authored, use a code exhibit.
   - Use a code exhibit for exact SQL, shell commands, request payloads, types, or
     algorithms that would lose meaning as prose. Preserve the real whitespace
     and name the language when known.
   - Use a procedure exhibit when the order itself matters. Keep each step an
     instruction, attach exact code only where the step needs it, and express
     branches or rollback as real steps rather than burying them in a paragraph.
   - Use an image exhibit when a diagram, screenshot, or other visual carries
     meaning prose would lose. Reference a path relative to the intent file or an
     `http(s)` URL, including for SVG files, and make its title useful as
     alternative text.
   - Use an HTML exhibit when the rendered document or interactive prototype is
     what reviewers need to inspect. Supply exactly one of a path or `http(s)`
     `uri`, or embedded `content` containing HTML or raw SVG. Use content when the
     rendered document belongs inside the intent itself; do not use HTML merely to
     restyle ordinary prose.
   - Treat one exhibit as one graph node. Link it to the outcome, boundary, or
     work item it clarifies; never create relationships for individual lines or
     procedure steps.
   - Do not use exhibits as a dumping ground for implementation notes. Ordinary
     rationale stays in prose or records, and delivery sequencing stays in
     the implementation sequence section. Include an exhibit only when its exact
     detail must land as written.
   - Connect the minimum useful entity set with relationships whose kinds capture
     a causal chain, lifecycle sequence, product-to-architecture realization,
     dependency, or preserved boundary. Reference both endpoints by their
     globally unique entity IDs; each node declares its type once and validation
     resolves it. Select those links in a domain-named map section when that
     projection is useful. Do not create a dense graph or repeat the relation as
     another record.
   - Judge a map as a topology, not an edge inventory. Every entity
     should have one stable place while labeled links reveal how it reaches the
     others. If the useful reading becomes a stack of repeated source and target
     cards, reduce or reshape the selected graph.
   - In a path map, make every path a coherent rooted subgraph. It may branch
     and merge, and several paths may share the same relationship, but its
     relationships must all be reachable outward from its root. Keep feedback
     as a supporting connection between entities already placed by paths so it
     does not turn the layout into a cycle.
   - Add named regions only when they let readers recognize meaningful places
     such as the shared gate, restart-only history, or preserved execution
     boundary. A node belongs to at most one region. Region titles organize the
     same entities; they do not introduce another taxonomy or copy content.
   - When a task benefits from architectural traceability, make the useful path
     followable in the task's own terms. Do not require an outcome-to-owner-to-
     exact-shape chain when another topology explains the change better.
   - Read the authored document without inspecting map nodes. If a relationship
     is carrying meaning the surrounding document never frames, improve the
     document rather than making the graph carry essential hidden prose.

5. **Admit only genuine workflow**
   - Put factual uncertainty in a `questions` section wherever it best fits the
     form.
   - Put human-owned alternatives in a `decisions` section. Remove choices
     already made by the request and mechanics that do not change observable
     behavior, durable structure, ownership, lifecycle, or another meaningful
     outcome.
   - Put shared content in ordinary sections. Let each option add only the
     records that differ, targeting any records section in the form.
   - Give material questions and decisions `affects` references. Put
     option-specific relationships on the option so any authored reading that
     selects them changes with the explored or recorded choice.
   - An option may add no records when its label and rationale completely express
     the decision.
   - Materialize every selectable combination of multiple decisions and repair
     contradictions or additions that assume missing state.
   - Keep human-owned decision status honest.

6. **Include delivery work only when requested**
   - Treat an implementation-plan request, whether initial or later, as ordinary
     authored content in the same form. Add or update the one native `sequence`
     section rather than creating a separate planning artifact or workflow.
   - Read the complete form and relevant code before decomposing work. Each
     independently verifiable work unit needs only a stable `id`, a reader-facing
     `title`, and values for the section's task-defined fields. Do not add
     records-only `view`, `provenance`, `subject`, `change`, or `explanation`
     fields.
   - Include only details that make the work actionable. Most sequences benefit
     from a domain-local equivalent of `Where it lands` and `Done when`; add
     ownership, risk, or validation only when they sharpen the handoff. Fold
     verification into the completion condition when a separate proof field
     would merely repeat it.
   - Keep the sequence subordinate to the primary reasoning surface. Place it
     where the build order naturally fits the document, and collapse it when
     opening it would turn the first read into a delivery checklist.
   - Link every settled structured obligation to at least one work unit with
     `implemented-by`: effective changed records and exhibits, decided additions,
     and each decided choice itself. Link relevant prose or list sections when
     they materially guide a work unit; these links add traceability without
     becoming required coverage. Every work item must be the target of at least
     one such link.
   - Put coverage for an option-owned addition on that option. Keep delivery
     dependencies as labeled root `depends-on` relations between work units.
   - Derive dependencies from what must exist before another unit can be
     implemented or verified. Never translate runtime `precedes`, `causes`, or
     `realized-by` relations mechanically into delivery order.
   - Prefer work units that can proceed independently. The sequence shows units
     in one derived phase together and keeps later phases blocked.
   - Use named `stages` only when real task-local phase names make a non-linear
     delivery story easier to understand. Each stage owns its work items, and its
     membership and authored order must exactly match the phases derived from
     `depends-on`. Keep ordinary linear sequences as flat `items`.
   - Read the sequence with obligation coverage collapsed. Its work titles,
     fields, and genuine parallel stages must still explain a useful delivery
     story. Dependency labels remain exact graph metadata rather than repeated
     card subtitles; coverage is traceability, not the visible substance of the
     sequence.
   - A strict linear sequence should read as compact numbered steps. If the
     reading shows repeated phase ceremony without real parallelism, simplify
     the work or dependency graph rather than padding the handoff.
   - Finish with no uncovered obligations, duplicate coverage or dependencies,
     or cycles.

7. **Compress and validate**
   - Delete repeated opening prose, purpose, record values, rationale, tradeoffs,
     provenance, and prose that merely restates a relationship.
   - Split independent changes, but never remove a distinct review outcome
     merely to shorten the board.
   - Write valid JSON to a concise `.intent` path in the current session's
     files folder.
   - Run the minimum-sufficient-form pass once more after the file validates.
   - Run the read-aloud test over every visible title, purpose, field label,
     record subject, exhibit title and instruction, question, choice, rationale,
     and relationship label.
   - Run the coherence test using only the title and open sections. Can a
     teammate follow the task's natural reasoning shape and explain the central
     change without reconstructing a generic template? If not, change the form,
     not merely the headings.
   - When architecture is material, run the architecture-fit test. A teammate
     should understand why the change belongs where it does and what important
     authority or boundary remains intact. If the answer is a file inventory
     rather than a domain explanation, simplify it.
   - Open every deeper surface the form actually uses. Confirm that each adds
     precision rather than restating the open document.
   - In each map section, confirm that current or preserved behavior is
     visibly intermingled with the changes and that every selected entity
     appears once. For a path map, follow every path in the rendered board:
     its root, branch, merge, relation labels, and supporting feedback should
     answer the task-named question without reading every node. Selecting one
     path must keep the rest legible on desktop and produce one coherent
     single-column route on mobile.
   - Read the rendered sections in order as plain text. Rewrite any fragment
     that sounds like a database row, compliance checklist, or architecture
     taxonomy instead of a teammate explaining the change.
   - Never call `open_file` for an `.intent`; Toy Box surfaces it automatically.
   - Preserve `savedVersion` unchanged when revising a board. It is an
     editor-owned comparison checkpoint, not content for an agent to regenerate.
   - Preserve each existing section's current `collapsed` value unless the human
     asks to restage the board's initial reading.
   - Preserve each records section's current `view` unless the human asks to
     change its table-or-cards default.
   - Do not preemptively add a delivery sequence. The document should be useful
     before any build order exists.

## File-owned worker callbacks

The editor may invoke this skill with `metadata.intent.action`. Read the actual
file, its section purposes, and relevant sources before rewriting it.

- `refresh-section`: locate the content section identified by `target` and
  re-derive it from its stated purpose and provenance policy.
  - Preserve the section's role in this form's task-specific reading shape. A
    refresh may deepen or correct it, but must not turn it into a disconnected
    architecture inventory or repeat an earlier section.
  - A prose, list, records, or exhibits refresh may revise its content
    and fields when the task evidence requires it. Preserve exact exhibit content
    unless the refreshed evidence justifies changing it.
  - A group refresh may revise its content subsections together only when the
    group contains no sequence, questions, or decisions.
  - If records fields change, update every decision addition targeting that
    records section and every affected relationship in the same valid rewrite.
  - If content or relationships selected by a map section change, keep that
    map's roots, paths, regions, and relationship selection valid or remove the
    map when it no longer sharpens the reading.
  - Never refresh a questions or decisions section wholesale, and never alter a
    human-owned choice or settled resolution through this action.
- `investigate-question`: obey the question's `resolutionMethod`.
  - For `investigate-code`, settle only what code can answer.
  - For `run-experiment`, record the observable result and its consequences.
  - If the question is actually a preference, replace it with an open decision.
  - Never turn evidence into a product choice on the user's behalf.
- `explain-item`: locate the globally unique records-section record identified by
  `target`, inspect the board and its provenance, and add or deepen its optional
  `explanation`. Explain rationale, boundaries, examples, or implications
  without restating values. If investigation reveals another record, evidence
  source, or alternative, update the form instead of hiding it in explanation.
- `start-work`: the human requested execution of the settled intent.
  - Reread the file and stop if questions or blocking decisions are unresolved.
  - When a sequence exists, stop unless at least one work unit is active, every
    settled obligation is covered, and its dependency graph is acyclic. Execute
    its phases in order; same-phase work may run concurrently when declared
    ownership and actual code changes do not conflict.
  - When no sequence exists, implement the complete settled document directly.
    Do not add a hidden sequence or require a separate planning step first.
  - Preserve the complete authored guidance, structured obligations, and decided
    choices. When a sequence exists, also preserve each work unit's covered
    obligations and completion condition.
  - If implementation reveals a false premise, uncovered obligation, or new
    product decision, stop and return that issue to the Intent instead of
    improvising.
