const AUTOMATION_SESSION_ID_PREFIX = "toy-box-auto-";
const AUTOMATION_SESSION_ID_RUN_SEPARATOR = "--run-";

export function createAutomationRunSessionId(automationId: string): string {
  return `${AUTOMATION_SESSION_ID_PREFIX}${automationId}${AUTOMATION_SESSION_ID_RUN_SEPARATOR}${crypto.randomUUID()}`;
}

export function getAutomationIdFromSessionId(sessionId: string): string | null {
  if (!sessionId.startsWith(AUTOMATION_SESSION_ID_PREFIX)) return null;

  const encoded = sessionId.slice(AUTOMATION_SESSION_ID_PREFIX.length);
  const separatorIndex = encoded.indexOf(AUTOMATION_SESSION_ID_RUN_SEPARATOR);
  if (separatorIndex <= 0) return null;

  const automationId = encoded.slice(0, separatorIndex);
  return automationId.length > 0 ? automationId : null;
}

export function isAutomationRunSession(sessionId: string): boolean {
  return getAutomationIdFromSessionId(sessionId) !== null;
}
