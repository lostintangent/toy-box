# Intent plans

Read this reference only when an `.intent` document contains or needs a plan, or
when a revision can change implementation coverage. Plan sections describe
ordered, independently verifiable work over the derived spec defined in
[schema.md](schema.md). They do not turn the spec into a build graph.

## Contents

- [Plan sections and steps](#plan-sections-and-steps)
- [Implementation links](#implementation-links)
- [Ordering and phases](#ordering-and-phases)
- [Derived plan state](#derived-plan-state)
- [Execution ownership](#execution-ownership)

## Plan sections and steps

One section is the ordinary case. A section owns exactly one of flat `steps` or
named `phases`:

```jsonc
PlanSection =
  | SectionCommon & {
      "kind": "plan",
      "fields": [Field, "..."], // optional; defaults to []
      "steps": [PlanStep, "..."]
    }
  | SectionCommon & {
      "kind": "plan",
      "fields": [Field, "..."], // optional; defaults to []
      "phases": [{
        "id": "phase ID unique within this section",
        "title": "reader-facing group name",
        "steps": [PlanStep, "..."]
      }, "..."]

PlanStep = {
  "id": "globally unique intent entity ID",
  "title": "action-oriented work",
  "doneWhen": "non-empty falsifiable completion criterion",
  "status": "in-progress" | "complete" | undefined,
  "implements": ["eligible intent entity ID", "..."],
  "values": { "field-id": "value or value array" } // optional; defaults to {}
}
```

Every plan section contains at least one step, directly or through non-empty
phases. Step IDs join the document-wide intent entity namespace. Each step has
one or more unique implementation links and values for exactly the section's
fields. Field IDs, labels, choice vocabularies, and values follow
[schema.md](schema.md); plan labels cannot reuse `Step`, `Done when`, or
`Status`.

Steps do not carry records-only `view`, `source`, `subject`, `change`, or
`explanation` fields. Omit custom fields entirely when titles and completion
criteria tell the plan clearly.

Any number of plan sections may appear, but each is top-level and all sections
collectively form one plan and one execution lifecycle. No plan sections means
no plan, not a synthetic `missing` status. Add another section only when a
distinct document location, tab, purpose, or step vocabulary materially
improves the reading.

## Implementation links

Each step's `implements` array owns its plan-specific relationships. Eligible
targets are:

- Markdown or list section guidance;
- non-`existing` shared records and decision-owned additions;
- non-`existing` section- or option-owned exhibits;
- a decision that has at least one self-contained option with neither additions
  nor an exhibit.

Findings and their supporting exhibits are evidence, not targets. Groups,
collection sections, plan sections, other plan steps, flow-local nodes,
connections, paths, regions, and phases are invalid targets. Every reference
must resolve even when it belongs to an inactive decision option.
An option exhibit is therefore a valid authored target before selection, but a
step that only implements it remains dormant until that option is decided.

A non-`existing` flow and the shared requirements it uses are independent
targets. Link the flow when its complete topology constrains the result; link a
shared requirement when that entity independently needs implementation; link
both when both obligations matter.

Every authored step must be capable of advancing at least one eligible entity.
Every current derived requirement must appear in at least one current step.
Avoid duplicate coverage unless separate work genuinely implements distinct
parts of the same requirement.

## Ordering and phases

Plan sections execute in document order. Flat steps execute in authored order.
Phased sections execute phases and then their steps in authored order.

A phase is a named grouping with an ID local to its section. It is not an intent
entity, dependency wave, concurrency declaration, relationship endpoint, or
plan target. Use phases only when the grouping itself clarifies execution.
Flow connections and decision relationships never order plan work.

## Derived plan state

`planSections(document)` returns all top-level plan sections in document order.
`planState(planSections(document), specState(document))` evaluates them as one
plan against the current derived spec.

A step is current when at least one implementation link refers to current spec
guidance or a current requirement. Reopening or changing a decision can make
authored option-only steps inactive and can introduce uncovered requirements;
the authored plan remains intact while its effective execution reading changes.

`PlanState` derives:

- `steps`: the current effective steps in execution order;
- resolved implementation targets for each current step;
- `unplannedRequirements`: current requirements not implemented by a current
  step;
- `fullyPlanned`: true only when at least one current step exists and every
  current requirement is covered;
- aggregate `status`; and
- `canExecute`.

Persisted step status is absent before execution, `in-progress` while work is
underway, and `complete` only after the completion criterion and relevant
validation succeed. `not-started` is derived and never written.

Aggregate status uses only current steps:

- `not-started` when no current step has persisted status;
- `in-progress` when at least one has started and not all are complete; and
- `complete` when every current step is complete.

The document can execute only when a plan exists, the spec is settled, the spec
is fully planned, and aggregate status is not complete. A settled document
without plan sections remains reviewable but has no execution action. A complete
plan may become executable again when a completed-outcome review appends
unstarted follow-up work implementing existing requirements.

## Execution ownership

The coordinating execution worker is the only automated writer of step status.
It writes `in-progress` immediately before starting a step and `complete` only
after `doneWhen` and required validation succeed. A human may explicitly correct
status through the editor.

Status never changes implementation links, authored order, or coverage. Plan
sections are not regenerated as ordinary content because steps, status, and
implementation links must remain coherent. Use `execute-toy-box-intent` for
execution, resume, and completed-outcome review.
