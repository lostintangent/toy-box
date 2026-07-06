import { useEffect, useId, useReducer } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cronToSimpleSchedule,
  DEFAULT_SIMPLE_SCHEDULE,
  normalizeSimpleSchedule,
  simpleScheduleToCron,
  type SimpleSchedule,
  type SimpleScheduleKind,
  WEEKDAY_OPTIONS,
} from "@/lib/automation/schedule";

type ScheduleInputMode = SimpleScheduleKind | "cron";

type ScheduleState = {
  mode: ScheduleInputMode;
  simpleSchedule: SimpleSchedule;
  modeHint: string | null;
};

type AutomationScheduleEditorProps = {
  value: string;
  onChange: (cron: string) => void;
  error: string | null;
};

const UNSUPPORTED_CRON_HINT = "This cron uses advanced syntax and can only be edited in cron mode.";
const SIMPLE_RESET_HINT = "Current cron could not be represented. Starting from a daily schedule.";

export function AutomationScheduleEditor({
  value,
  onChange,
  error,
}: AutomationScheduleEditorProps) {
  const idPrefix = useId();
  const [state, dispatch] = useReducer(scheduleReducer, value, initializeScheduleState);
  const normalizedSimpleSchedule = normalizeSimpleSchedule(state.simpleSchedule);

  useEffect(() => {
    dispatch({ type: "externalCronChanged", cron: value });
  }, [value]);

  function updateSimpleSchedule(schedule: SimpleSchedule) {
    dispatch({ type: "simpleScheduleChanged", schedule });
    onChange(simpleScheduleToCron(schedule));
  }

  function updateScheduleForMode(
    mode: Exclude<ScheduleInputMode, "cron">,
    patch: Partial<Omit<SimpleSchedule, "kind">>,
  ) {
    updateSimpleSchedule(
      ensureScheduleMode(
        {
          ...normalizedSimpleSchedule,
          ...patch,
        },
        mode,
      ),
    );
  }

  function updateMode(mode: ScheduleInputMode) {
    const transition = getScheduleModeTransition(state, value, mode);
    if (!transition.cron) return;
    dispatch({ type: "modeChanged", mode, cron: value });
    onChange(transition.cron);
  }

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-md border border-border/70 bg-muted/30 p-0.5">
        <Button
          type="button"
          size="sm"
          variant={state.mode === "daily" ? "secondary" : "ghost"}
          className="h-7 px-2"
          onClick={() => updateMode("daily")}
        >
          Daily
        </Button>
        <Button
          type="button"
          size="sm"
          variant={state.mode === "interval" ? "secondary" : "ghost"}
          className="h-7 px-2"
          onClick={() => updateMode("interval")}
        >
          Interval
        </Button>
        <Button
          type="button"
          size="sm"
          variant={state.mode === "cron" ? "secondary" : "ghost"}
          className="h-7 px-2"
          onClick={() => updateMode("cron")}
        >
          Cron
        </Button>
      </div>

      {state.modeHint && <p className="text-xs text-muted-foreground">{state.modeHint}</p>}

      {state.mode === "daily" ? (
        <div className="rounded-md border border-border/70 p-2">
          <div className="flex min-w-0 flex-wrap items-start gap-3">
            <div className="shrink-0">
              <label className="mb-1 block text-sm font-medium" htmlFor={`${idPrefix}-daily-time`}>
                Time
              </label>
              <Input
                id={`${idPrefix}-daily-time`}
                type="time"
                step={60}
                className="w-24"
                value={formatTimeValue(
                  normalizedSimpleSchedule.hour,
                  normalizedSimpleSchedule.minute,
                )}
                onChange={(event) => {
                  const parsed = parseTimeValue(event.target.value);
                  if (!parsed) return;
                  updateScheduleForMode("daily", {
                    hour: parsed.hour,
                    minute: parsed.minute,
                  });
                }}
              />
            </div>

            <WeekdaySelector
              selectedDays={normalizedSimpleSchedule.daysOfWeek}
              onChange={(daysOfWeek) => updateScheduleForMode("daily", { daysOfWeek })}
            />
          </div>
        </div>
      ) : state.mode === "interval" ? (
        <div className="rounded-md border border-border/70 p-2">
          <div className="flex min-w-0 flex-wrap items-start gap-3">
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
                  value={normalizedSimpleSchedule.intervalHours}
                  onChange={(event) =>
                    updateScheduleForMode("interval", {
                      intervalHours: parseIntegerInput(event.target.value),
                    })
                  }
                />
                <span className="text-sm text-muted-foreground shrink-0">hours</span>
              </div>
            </div>

            <WeekdaySelector
              selectedDays={normalizedSimpleSchedule.daysOfWeek}
              onChange={(daysOfWeek) => updateScheduleForMode("interval", { daysOfWeek })}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor={`${idPrefix}-cron`}>
            Cron
          </label>
          <Input
            id={`${idPrefix}-cron`}
            value={value}
            onChange={(event) => {
              dispatch({ type: "cronEdited" });
              onChange(event.target.value);
            }}
            placeholder="0 * * * *"
          />
          <p className="text-xs text-muted-foreground">Uses the server's local timezone.</p>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function parseIntegerInput(value: string): number {
  if (value.trim().length === 0) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTimeValue(hour: number, minute: number): string {
  const normalizedHour = Math.min(23, Math.max(0, Math.round(hour)));
  const normalizedMinute = Math.min(59, Math.max(0, Math.round(minute)));
  return `${String(normalizedHour).padStart(2, "0")}:${String(normalizedMinute).padStart(2, "0")}`;
}

function parseTimeValue(value: string): { hour: number; minute: number } | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function toggleWeekday(daysOfWeek: number[], dayOfWeek: number): number[] {
  const hasDay = daysOfWeek.includes(dayOfWeek);
  if (hasDay && daysOfWeek.length === 1) return daysOfWeek;
  if (hasDay) return daysOfWeek.filter((value) => value !== dayOfWeek);
  return [...daysOfWeek, dayOfWeek].sort((a, b) => a - b);
}

function ensureScheduleMode(
  schedule: SimpleSchedule,
  mode: Exclude<ScheduleInputMode, "cron">,
): SimpleSchedule {
  const normalized = normalizeSimpleSchedule({
    ...schedule,
    kind: mode,
  });
  if (mode === "interval") {
    return {
      ...normalized,
      minute: 0,
    };
  }
  return normalized;
}

function initializeScheduleState(cron: string): ScheduleState {
  const parsed = cronToSimpleSchedule(cron);
  return {
    mode: parsed ? parsed.kind : "cron",
    simpleSchedule: parsed ?? DEFAULT_SIMPLE_SCHEDULE,
    modeHint: parsed || cron.trim().length === 0 ? null : UNSUPPORTED_CRON_HINT,
  };
}

type ScheduleAction =
  | { type: "externalCronChanged"; cron: string }
  | { type: "simpleScheduleChanged"; schedule: SimpleSchedule }
  | { type: "modeChanged"; mode: ScheduleInputMode; cron: string }
  | { type: "cronEdited" };

type ScheduleModeTransition = {
  state: ScheduleState;
  cron: string | null;
};

function getScheduleModeTransition(
  state: ScheduleState,
  cron: string,
  mode: ScheduleInputMode,
): ScheduleModeTransition {
  if (mode === state.mode) return { state, cron: null };

  const normalizedSimpleSchedule = normalizeSimpleSchedule(state.simpleSchedule);

  if (mode === "cron") {
    const currentSimpleMode = state.mode === "cron" ? "daily" : state.mode;
    return {
      state: {
        ...state,
        mode,
        modeHint: null,
      },
      cron: simpleScheduleToCron(ensureScheduleMode(normalizedSimpleSchedule, currentSimpleMode)),
    };
  }

  const parsed = state.mode === "cron" ? cronToSimpleSchedule(cron) : normalizedSimpleSchedule;
  const nextSchedule = ensureScheduleMode(parsed || DEFAULT_SIMPLE_SCHEDULE, mode);
  return {
    state: {
      mode,
      simpleSchedule: nextSchedule,
      modeHint: parsed ? null : SIMPLE_RESET_HINT,
    },
    cron: simpleScheduleToCron(nextSchedule),
  };
}

function scheduleReducer(state: ScheduleState, action: ScheduleAction): ScheduleState {
  switch (action.type) {
    case "externalCronChanged":
      return initializeScheduleState(action.cron);

    case "simpleScheduleChanged":
      return {
        ...state,
        simpleSchedule: action.schedule,
        modeHint: null,
      };

    case "modeChanged":
      return getScheduleModeTransition(state, action.cron, action.mode).state;

    case "cronEdited":
      return {
        ...state,
        modeHint: null,
      };
  }
}

type WeekdaySelectorProps = {
  selectedDays: number[];
  onChange: (nextDays: number[]) => void;
};

function WeekdaySelector({ selectedDays, onChange }: WeekdaySelectorProps) {
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
