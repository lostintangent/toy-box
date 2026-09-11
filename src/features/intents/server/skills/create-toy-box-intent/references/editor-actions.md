# Intent Editor Actions

Read the actual `.intent` file, its section purposes, the complete
[schema reference](schema.md), and relevant sources before changing it. Read
[plan.md](plan.md) whenever the document has a plan whose coverage or references
may need repair. Preserve the rest of the document and perform only the action
named by `metadata.intent.action`.

## `regenerate-section`

Locate the content section identified by `sectionId` and rederive it from its
purpose and source policy.

- Preserve its role in the document's reading shape. Deepen or correct it
  without turning it into a disconnected inventory or a repetition of another
  section.
- Regenerate findings, Markdown, lists, records, or exhibits when evidence
  warrants it. Preserve authored exhibit content unless the new evidence
  justifies changing it.
- When findings change, revalidate every grounding reference and the spec it
  shaped. Never leave a true link pointing at a materially different fact.
- Never regenerate questions, decisions, or a plan through this action, and
  never alter a human-owned choice or settled answer.
- When record fields change, repair every decision addition targeting that
  records section and every affected decision relationship or flow in the same
  valid rewrite.
- When a shared entity used by a flow changes, keep the flow coherent and valid
  or remove it if its topology no longer defines a useful requirement.
  Regenerate a flow as one topology rather than patching labels around a false
  graph.

## `investigate-question`

Locate `questionId` and follow its authored answer method.

- For code investigation, settle only what the code can establish.
- For an experiment, record the observable result and its consequences.
- Replace the question with an open decision when it is actually a preference.
  Never turn evidence into a product choice on the user's behalf.
- When the answer is a load-bearing fact, preserve it as a concise sourced
  finding and ground the affected spec entities. Keep the answer focused on the
  original uncertainty.

## `explain-record`

Locate the globally unique shared or option-owned record identified by
`recordId`, inspect the document and its sources, and add or deepen its optional
explanation without changing its owner. Explain rationale, boundaries, examples,
or implications without restating its field values. If investigation reveals
another record, evidence source, or alternative, update the document instead of
hiding it in the explanation.

## Finish the action

Preserve unrelated content, section collapse, records views, valid tab
membership, human choices and answers, and plan-step status. Repair all affected
references in the same rewrite, validate the complete document, and do not call
`open_file`; Toy Box surfaces the changed intent automatically.
