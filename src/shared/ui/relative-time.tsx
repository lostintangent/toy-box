export interface RelativeTimeProps {
  date: Date | string;
  className?: string;
}

/**
 * Format a date as a relative time string (e.g., "2 hours ago", "yesterday").
 */
const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffSeconds = Math.round(diffMs / 1000);
  const diffMinutes = Math.round(diffSeconds / 60);
  const diffHours = Math.round(diffMinutes / 60);
  const diffDays = Math.round(diffHours / 24);

  if (Math.abs(diffDays) >= 1) {
    return relativeTimeFormatter.format(diffDays, "day");
  }
  if (Math.abs(diffHours) >= 1) {
    return relativeTimeFormatter.format(diffHours, "hour");
  }
  if (Math.abs(diffMinutes) >= 1) {
    return relativeTimeFormatter.format(diffMinutes, "minute");
  }
  return "now";
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const value = typeof date === "string" ? new Date(date) : date;

  return (
    <time className={className} dateTime={value.toISOString()} suppressHydrationWarning>
      {formatRelativeTime(value)}
    </time>
  );
}
