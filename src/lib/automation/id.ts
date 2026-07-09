const AUTOMATION_ID_PREFIX = "toy-box-auto-";
const AUTOMATION_ID_PATTERN =
  /^toy-box-auto-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAutomationId(): string {
  return `${AUTOMATION_ID_PREFIX}${crypto.randomUUID()}`;
}

export function isAutomationId(id: string): boolean {
  return AUTOMATION_ID_PATTERN.test(id);
}
