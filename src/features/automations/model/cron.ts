import { CronExpressionParser } from "cron-parser";

const FALLBACK_TIMEZONE = "UTC";

const AUTOMATION_CRON_TIMEZONE = resolveLocalTimezone();

export function validateAutomationCronDefinition(cron: string): void {
  parseAutomationCronExpression(cron, new Date());
}

export function computeNextAutomationRunAt(cron: string, fromDate: Date): Date {
  return parseAutomationCronExpression(cron, fromDate).next().toDate();
}

// Form state remembers inactive tab inputs; only the selected mode defines the cron.
export type ScheduleDraft = {
  mode: "daily" | "interval" | "cron";
  time: string;
  intervalHours: number;
  daysOfWeek: number[];
  cron: string;
};

export function scheduleToCron(schedule: ScheduleDraft): string {
  if (schedule.mode === "cron") return schedule.cron;
  const days = schedule.daysOfWeek.length === 7 ? "*" : schedule.daysOfWeek.join(",");

  if (schedule.mode === "daily") {
    const [hour, minute] = schedule.time.split(":").map(Number);
    return `${minute} ${hour} * * ${days}`;
  }

  const hours = schedule.intervalHours === 1 ? "*" : `*/${schedule.intervalHours}`;
  return `0 ${hours} * * ${days}`;
}

export function cronToSchedule(cron: string): ScheduleDraft {
  const draft: ScheduleDraft = {
    mode: "cron",
    time: "09:00",
    intervalHours: 1,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    cron,
  };
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return draft;

  const [minuteRaw, hourRaw, dayOfMonthRaw, monthRaw, dayOfWeekRaw] = fields;
  if (dayOfMonthRaw !== "*" || monthRaw !== "*") return draft;

  const minute = parseNumericField(minuteRaw, 0, 59);
  const daysOfWeek = parseDaysOfWeekField(dayOfWeekRaw);
  if (minute === null || !daysOfWeek) return draft;

  const hour = parseNumericField(hourRaw, 0, 23);
  if (hour !== null) {
    return {
      ...draft,
      mode: "daily",
      time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      daysOfWeek,
    };
  }

  // Interval mode supports top-of-hour schedules only.
  const intervalHours = parseIntervalHoursField(hourRaw);
  if (minute !== 0 || intervalHours === null) return draft;
  return { ...draft, mode: "interval", intervalHours, daysOfWeek };
}

function resolveLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function parseAutomationCronExpression(cron: string, currentDate: Date) {
  return CronExpressionParser.parse(cron.trim(), {
    currentDate,
    tz: AUTOMATION_CRON_TIMEZONE,
  });
}

function parseDaysOfWeekField(value: string): number[] | null {
  const trimmed = value.trim();
  if (trimmed === "*") {
    return [0, 1, 2, 3, 4, 5, 6];
  }

  const tokens = trimmed
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const days: number[] = [];
  for (const token of tokens) {
    const parsed = parseDayOfWeekField(token);
    if (parsed === null) return null;
    days.push(parsed);
  }

  return [...new Set(days)].sort((a, b) => a - b);
}

function parseIntervalHoursField(value: string): number | null {
  if (value === "*") return 1;

  const match = value.match(/^\*\/(\d+)$/);
  if (!match) return null;

  const parsed = Number.parseInt(match[1], 10);
  if (parsed < 1 || parsed > 24) return null;
  return parsed;
}

function parseNumericField(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function parseDayOfWeekField(value: string): number | null {
  const lowered = value.toLowerCase();
  if (Object.hasOwn(WEEKDAY_NAME_TO_VALUE, lowered)) {
    return WEEKDAY_NAME_TO_VALUE[lowered];
  }

  const numeric = parseNumericField(value, 0, 7);
  if (numeric === null) return null;
  return numeric === 7 ? 0 : numeric;
}

const WEEKDAY_NAME_TO_VALUE: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};
