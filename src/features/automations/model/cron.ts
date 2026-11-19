import { CronExpressionParser } from "cron-parser";

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

/** Opens a cron in the visual mode that saves the same schedule, or as raw cron when none does. */
export function cronToSchedule(cron: string): ScheduleDraft {
  const draft: ScheduleDraft = {
    mode: "cron",
    time: "09:00",
    intervalHours: 1,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    cron,
  };
  // A hashed field (H) takes a new value on every parse, so it has no fixed visual form.
  if (/\bH/.test(cron)) return draft;

  try {
    const { fields } = CronExpressionParser.parse(cron);
    const [minute] = fields.minute.values;
    const hours = fields.hour.values;
    const daysOfWeek = [...new Set(fields.dayOfWeek.values.map((day) => Number(day) % 7))].sort(
      (left, right) => left - right,
    );
    const schedule: ScheduleDraft =
      hours.length === 1
        ? { ...draft, mode: "daily", time: [hours[0], minute].map(pad).join(":"), daysOfWeek }
        : { ...draft, mode: "interval", intervalHours: hours[1], daysOfWeek };

    // Seconds, days of the month, months, uneven hours, and nth or last weekdays have no
    // visual form, so their candidate saves a different schedule or none at all.
    const candidate = CronExpressionParser.parse(scheduleToCron(schedule)).fields;
    return candidate.stringify(true) === fields.stringify(true) ? schedule : draft;
  } catch {
    return draft;
  }
}

function pad(part: number): string {
  return String(part).padStart(2, "0");
}
