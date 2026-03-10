import { CronExpressionParser } from "cron-parser";

const FALLBACK_TIMEZONE = "UTC";

function resolveLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

export const AUTOMATION_CRON_TIMEZONE = resolveLocalTimezone();

export function validateAutomationCronDefinition(cron: string): void {
  parseAutomationCronExpression(cron, new Date());
}

export function computeNextAutomationRunAt(cron: string, fromDate: Date): Date {
  const expression = parseAutomationCronExpression(cron, fromDate);
  return expression.next().toDate();
}

function parseAutomationCronExpression(cron: string, currentDate: Date) {
  return CronExpressionParser.parse(cron.trim(), {
    currentDate,
    tz: AUTOMATION_CRON_TIMEZONE,
  });
}
