import { cn } from "@/shared/utils";

/** A thin completion bar for the count beside it, from 0 to 1. */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <span aria-hidden className={cn("h-1 w-8 overflow-hidden rounded-full bg-muted", className)}>
      <span
        className="block h-full rounded-full bg-accent transition-[width]"
        style={{ width: `${value * 100}%` }}
      />
    </span>
  );
}
