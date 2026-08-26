---
name: execute-toy-box-intent
description: "Execute, resume, or review the settled implementation plan in a Toy Box `.intent` document. Advance durable plan-step status and publish execution results for `metadata.intent.action: execute-plan`; inspect the completed outcome and append only warranted follow-up work for `metadata.intent.action: review-outcome`."
---

# Execute and Review a Toy Box Intent Plan

Execute the authored plan or review its completed outcome; do not silently
redesign it. The intent is durable truth for the agreed spec, execution order,
completion conditions, and status. Outcome review is an optional action, not a
stored lifecycle state.

Before changing code or the intent:

1. Read the complete `.intent` file.
2. Read the authoring skill's complete
   [schema reference](../create-toy-box-intent/references/schema.md), including
   its exhibit shapes, and the
   [plan contract](../create-toy-box-intent/references/plan.md) completely.
3. Read the relevant repository guides, implementation, tests, and direct
   consumers for the next unfinished step.

Follow only the workflow requested by `metadata.intent.action`. An explicit
human request to implement or resume means `execute-plan`; an explicit request
to inspect what landed after completion means `review-outcome`.

## Execute or resume the plan

### Establish executability

Stop and return the issue to the intent when:

- a question or decision remains unresolved;
- no plan exists;
- no step implements the current spec;
- a spec requirement has no plan step; or
- implementation reveals a false premise, unplanned requirement, or new product
  decision.

Absence of a plan does not authorize direct implementation of the rest of the
document. Never improvise around an unresolved gap.

### Execute in authored order

Execute plan sections in document order. Within a section, execute flat steps in
order or phases and their steps in order. A phase is a named grouping, not
permission to reorder or parallelize work.

For each remaining step:

1. Reread the latest intent and merge any unrelated human or worker edits before
   writing status.
2. Skip or verify a complete step. Otherwise persist `in-progress` immediately
   before starting it. Never write `not-started`; absence means not started.
3. Preserve the authored spec, decided choices, implementation links, and
   completion condition while making the repository change.
4. Follow repository instructions, including any required review or dogfood
   skill, focused validation, and quality gates.
5. Persist `complete` only after the authored completion condition and relevant
   validation succeed.

Do not begin a later step or phase until the earlier one completes. If execution
fails or stops, leave the current step in progress so another run can identify
and resume it. This coordinating execution worker is the only automated writer
of plan-step status; a human may still correct status through the editor.

### Publish the result

After every step completes, add or update a concise account of what changed and
the validation evidence. Use ordinary Markdown for narrative, commands, and code
excerpts. Use records or exhibits only when comparable or rendered evidence
needs independent identity, and represent it as `existing` landed reality so it
does not create another spec requirement.

Present the account in an `Execution results` tab:

- When the document has no tabs, create `Intent` containing every pre-existing
  top-level section and `Execution results` containing the new result sections.
- When tabs already exist, preserve their memberships and add or reuse
  `Execution results`.
- Keep every top-level section in exactly one tab and preserve root section
  order within each tab.

Reread and validate the final intent, confirm every step is complete, and never
call `open_file`; Toy Box surfaces the changed document automatically.

## Review the completed outcome

Run this workflow only when requested, when the spec is settled, and when a
fully planned document has every current step complete. Review without
implementing new work in the same run.

1. Compare the settled spec and each completion condition with the repository
   state that actually landed, its execution results, and relevant validation.
   Invoke repository-owned review or validation skills when their instructions
   require it; this workflow coordinates their findings rather than replacing
   them.
2. Investigate only plausible material gaps. Trace implicated authority,
   ownership, lifecycle, persistence, concurrency, bounded-capacity, and
   failure paths through the changed boundary. Do not manufacture an exhaustive
   risk inventory or reopen settled choices merely because another design was
   possible.
3. Keep a finding only when it is supported by current evidence and would
   materially improve conformance to the spec, correctness, operability, or
   maintainability. Ignore cosmetic polish, speculative expansion, and routine
   implementation detail that normal local edits can resolve.
4. If the outcome satisfies the spec and no worthwhile follow-up remains,
   preserve the completed plan. Add or update one concise `Outcome review`
   Markdown section in the `Execution results` tab with the conclusion and
   decisive evidence. Summarize evidence by outcome or boundary instead of
   inventorying every passing probe or command; do not repeat execution-result
   detail unless it affected the review decision.
5. If implementation violates the settled spec or a worthwhile hardening task
   merits another execution pass, preserve every completed step and append the
   smallest ordered follow-up segment. Append a phase when the final plan
   section already uses phases; otherwise append one compact top-level plan
   section rather than restructuring completed history solely to manufacture a
   phase. New steps omit status, state a falsifiable completion condition, and
   implement the affected existing requirements. Keep the follow-up segment in
   the same tab as the existing plan.
6. If the evidence instead reveals a new product decision or materially changes
   the agreed outcome, preserve it as a question or decision for the human and
   do not invent a follow-up step around an unsettled spec.

Update or create the single `Outcome review` result section with the conclusion,
the evidence that determined it, and why follow-up was or was not warranted. Use
the same `Execution results` tab-partition rules as execution, keep every
top-level section in exactly one tab, validate the complete intent, and stop.
When follow-up work was added, the derived plan becomes executable again and a
later `execute-plan` resumes after the completed work.
