export type BriefAction =
  | { action: "regenerate-section"; sectionId: string }
  | { action: "investigate-question"; questionId: string }
  | { action: "explain-record"; recordId: string }
  | { action: "execute-plan" }
  | { action: "review-outcome" };

export function briefActionTarget(request: BriefAction): string | undefined {
  if (request.action === "regenerate-section") return request.sectionId;
  if (request.action === "investigate-question") return request.questionId;
  if (request.action === "explain-record") return request.recordId;
}

export function briefActionKey(request: BriefAction): string {
  const target = briefActionTarget(request);
  return target ? `${request.action}:${target}` : request.action;
}
