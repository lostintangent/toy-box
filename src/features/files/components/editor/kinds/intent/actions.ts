import { intentActionTarget, type IntentAction } from "@intents/actions";
import type { WorkerRequest } from "../../../../useFile";

const ACTION_NAMES: Record<IntentAction["action"], string> = {
  "regenerate-section": "Regenerate a section",
  "investigate-question": "Answer an open question",
  "explain-record": "Explain a record",
  "execute-plan": "Execute the plan",
  "review-outcome": "Review the outcome",
};

export function intentWorkerRequest(request: IntentAction): WorkerRequest {
  const target = intentActionTarget(request);
  return {
    name: target
      ? `${ACTION_NAMES[request.action]}: ${target}`.slice(0, 100)
      : ACTION_NAMES[request.action],
    prompt: intentWorkerPrompt(request),
    metadata: request,
  };
}

function intentWorkerPrompt(request: IntentAction): string {
  if (request.action === "execute-plan") {
    return "Use the registered `execute-toy-box-intent` skill to execute or resume this intent's plan.";
  }
  if (request.action === "review-outcome") {
    return "Use the registered `execute-toy-box-intent` skill's post-execution workflow to review this completed intent's outcome.";
  }
  const targetInstruction =
    request.action === "regenerate-section"
      ? ` for section "${request.sectionId}"`
      : request.action === "investigate-question"
        ? ` for question "${request.questionId}"`
        : ` for record "${request.recordId}"`;

  return `Use the registered \`create-toy-box-intent\` skill's \`${request.action}\` editor-action workflow${targetInstruction}.`;
}
