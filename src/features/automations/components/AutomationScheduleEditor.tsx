import { useId, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cronToSchedule, scheduleToCron, type ScheduleDraft } from "../model";

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

export function AutomationScheduleEditor({
  value,
  onChange,
  error,
}: {
  value: ScheduleDraft;
  onChange: (schedule: ScheduleDraft) => void;
  error: string | null;
}) {
  const idPrefix = useId();
  const [hint, setHint] = useState<string | null>(() =>
    value.mode === "cron" && value.cron.trim()
      ? "This cron uses advanced syntax and can only be edited in cron mode."
      : null,
  );

  function update(patch: Partial<ScheduleDraft>) {
    setHint(null);
    onChange({ ...value, ...patch });
  }

  function changeMode(mode: ScheduleDraft["mode"]) {
    if (mode === value.mode) return;
    if (mode === "cron") {
      update({ mode, cron: scheduleToCron(value) });
    } else if (value.mode === "cron") {
      const parsed = cronToSchedule(value.cron);
      setHint(
        parsed.mode === "cron"
          ? "Current cron could not be represented. Using default settings."
          : null,
      );
      onChange({ ...parsed, mode });
    } else {
      update({ mode });
    }
  }

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-md border border-border/70 bg-muted/30 p-0.5">
        <Button
          type="button"
          size="sm"
          variant={value.mode === "daily" ? "secondary" : "ghost"}
          className="h-7 px-2"
          onClick={() => changeMode("daily")}
        >
          Daily
        </Button>
        <Button
          type="button"
          size="sm"
          variant={value.mode === "interval" ? "secondary" : "ghost"}
          className="h-7 px-2"
          onClick={() => changeMode("interval")}
        >
          Interval
        </Button>
        <Button
          type="button"
          size="sm"
          variant={value.mode === "cron" ? "secondary" : "ghost"}
          className="h-7 px-2"
          onClick={() => changeMode("cron")}
        >
          Cron
        </Button>
      </div>

      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

      {value.mode === "cron" ? (
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor={`${idPrefix}-cron`}>
            Cron
          </label>
          <Input
            id={`${idPrefix}-cron`}
            value={value.cron}
            onChange={(event) => update({ cron: event.target.value })}
            placeholder="0 * * * *"
          />
          <p className="text-xs text-muted-foreground">Uses the server's local timezone.</p>
        </div>
      ) : (
        <div className="rounded-md border border-border/70 p-2">
          <div className="flex min-w-0 flex-wrap items-start gap-3">
            {value.mode === "daily" ? (
              <div className="shrink-0">
                <label
                  className="mb-1 block text-sm font-medium"
                  htmlFor={`${idPrefix}-daily-time`}
                >
                  Time
                </label>
                <Input
                  id={`${idPrefix}-daily-time`}
                  type="time"
                  step={60}
                  className="w-24"
                  value={value.time}
                  onChange={(event) => {
                    if (event.target.value && event.target.validity.valid) {
                      update({ time: event.target.value });
                    }
                  }}
                />
              </div>
            ) : (
              <div className="w-28 shrink-0 space-y-1">
                <label className="text-sm font-medium" htmlFor={`${idPrefix}-interval-hours`}>
                  Every
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${idPrefix}-interval-hours`}
                    type="number"
                    min={1}
                    max={24}
                    value={value.intervalHours}
                    onChange={(event) =>
                      update({
                        intervalHours: Math.min(
                          24,
                          Math.max(1, Math.round(event.target.valueAsNumber || 1)),
                        ),
                      })
                    }
                  />
                  <span className="text-sm text-muted-foreground shrink-0">hours</span>
                </div>
              </div>
            )}
            <WeekdaySelector
              selectedDays={value.daysOfWeek}
              onChange={(daysOfWeek) => update({ daysOfWeek })}
            />
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function toggleWeekday(daysOfWeek: number[], dayOfWeek: number): number[] {
  const hasDay = daysOfWeek.includes(dayOfWeek);
  if (hasDay && daysOfWeek.length === 1) return daysOfWeek;
  if (hasDay) return daysOfWeek.filter((value) => value !== dayOfWeek);
  return [...daysOfWeek, dayOfWeek].sort((a, b) => a - b);
}

function WeekdaySelector({
  selectedDays,
  onChange,
}: {
  selectedDays: number[];
  onChange: (nextDays: number[]) => void;
}) {
  const labelId = useId();

  return (
    <div className="min-w-0 flex-1 space-y-1">
      <p className="text-sm font-medium" id={labelId}>
        Days
      </p>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-labelledby={labelId}>
        {WEEKDAY_OPTIONS.map((option) => {
          const isSelected = selectedDays.includes(option.value);
          return (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={isSelected ? "secondary" : "outline"}
              className="h-7 px-2 text-xs transition-none"
              aria-pressed={isSelected}
              onClick={() => onChange(toggleWeekday(selectedDays, option.value))}
            >
              {option.label.slice(0, 3)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
