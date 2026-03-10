export type SimpleScheduleKind = "daily" | "interval";

export type SimpleSchedule = {
  kind: SimpleScheduleKind;
  minute: number;
  hour: number;
  intervalHours: number;
  daysOfWeek: number[];
};

type WeekdayOption = {
  value: number;
  label: string;
};

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export const WEEKDAY_OPTIONS: WeekdayOption[] = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

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

export const DEFAULT_SIMPLE_SCHEDULE: SimpleSchedule = {
  kind: "daily",
  minute: 0,
  hour: 9,
  intervalHours: 1,
  daysOfWeek: [...ALL_WEEKDAYS],
};

export function simpleScheduleToCron(schedule: SimpleSchedule): string {
  const normalized = normalizeSimpleSchedule(schedule);
  const dayOfWeekField = serializeDaysOfWeekField(normalized.daysOfWeek);

  if (normalized.kind === "daily") {
    return `${normalized.minute} ${normalized.hour} * * ${dayOfWeekField}`;
  }

  const hourField = normalized.intervalHours === 1 ? "*" : `*/${normalized.intervalHours}`;
  return `${normalized.minute} ${hourField} * * ${dayOfWeekField}`;
}

export function cronToSimpleSchedule(cron: string): SimpleSchedule | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minuteRaw, hourRaw, dayOfMonthRaw, monthRaw, dayOfWeekRaw] = fields;
  if (dayOfMonthRaw !== "*" || monthRaw !== "*") return null;

  const minute = parseNumericField(minuteRaw, 0, 59);
  if (minute === null) return null;

  const daysOfWeek = parseDaysOfWeekField(dayOfWeekRaw);
  if (!daysOfWeek) return null;

  const hour = parseNumericField(hourRaw, 0, 23);
  if (hour !== null) {
    return normalizeSimpleSchedule({
      ...DEFAULT_SIMPLE_SCHEDULE,
      kind: "daily",
      minute,
      hour,
      daysOfWeek,
    });
  }

  // Interval mode currently supports top-of-hour schedules only.
  if (minute !== 0) return null;

  const intervalHours = parseIntervalHoursField(hourRaw);
  if (intervalHours === null) return null;

  return normalizeSimpleSchedule({
    ...DEFAULT_SIMPLE_SCHEDULE,
    kind: "interval",
    minute,
    intervalHours,
    daysOfWeek,
  });
}

export function normalizeSimpleSchedule(schedule: SimpleSchedule): SimpleSchedule {
  return {
    kind: schedule.kind,
    minute: clampInteger(schedule.minute, 0, 59),
    hour: clampInteger(schedule.hour, 0, 23),
    intervalHours: clampInteger(schedule.intervalHours, 1, 24),
    daysOfWeek: normalizeDaysOfWeek(schedule.daysOfWeek),
  };
}

function serializeDaysOfWeekField(daysOfWeek: number[]): string {
  if (daysOfWeek.length === 7) return "*";
  return daysOfWeek.join(",");
}

function normalizeDaysOfWeek(daysOfWeek: number[]): number[] {
  const normalized = new Set<number>();

  for (const day of daysOfWeek) {
    const normalizedDay = day === 7 ? 0 : day;
    normalized.add(clampInteger(normalizedDay, 0, 6));
  }

  if (normalized.size === 0) {
    return [...ALL_WEEKDAYS];
  }

  return [...normalized].sort((a, b) => a - b);
}

function parseDaysOfWeekField(value: string): number[] | null {
  const trimmed = value.trim();
  if (trimmed === "*") {
    return [...ALL_WEEKDAYS];
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

  return normalizeDaysOfWeek(days);
}

function parseIntervalHoursField(value: string): number | null {
  if (value === "*") return 1;

  const match = value.match(/^\*\/(\d+)$/);
  if (!match) return null;

  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 1 || parsed > 24) return null;
  return parsed;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function parseNumericField(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function parseDayOfWeekField(value: string): number | null {
  const lowered = value.toLowerCase();
  if (lowered in WEEKDAY_NAME_TO_VALUE) {
    return WEEKDAY_NAME_TO_VALUE[lowered];
  }

  const numeric = parseNumericField(value, 0, 7);
  if (numeric === null) return null;
  return numeric === 7 ? 0 : numeric;
}
