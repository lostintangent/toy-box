const clockFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const fullFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });

/** A time of day with its full date on hover, for timelines already divided by day. */
export function ClockTime({ date, className }: { date: Date | string; className?: string }) {
  const value = typeof date === "string" ? new Date(date) : date;

  return (
    <time
      className={className}
      dateTime={value.toISOString()}
      title={fullFormatter.format(value)}
      suppressHydrationWarning
    >
      {clockFormatter.format(value)}
    </time>
  );
}
