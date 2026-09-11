export type IntentAction =
  | { action: "regenerate-section"; sectionId: string }
  | { action: "investigate-question"; questionId: string }
  | { action: "explain-record"; recordId: string }
  | { action: "execute-plan" }
  | { action: "review-outcome" };

export function intentActionTarget(request: IntentAction): string | undefined {
  if (request.action === "regenerate-section") return request.sectionId;
  if (request.action === "investigate-question") return request.questionId;
  if (request.action === "explain-record") return request.recordId;
}

export function intentActionKey(request: IntentAction): string {
  const target = intentActionTarget(request);
  return target ? `${request.action}:${target}` : request.action;
}
