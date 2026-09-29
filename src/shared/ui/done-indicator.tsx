import type { ComponentProps } from "react";
import { cn } from "@/shared/utils";

/** Work is done: a soft green disc and check on the same circle as the running arc. */
export function DoneIndicator({
  className,
  ...props
}: Omit<ComponentProps<"svg">, "ref" | "children">) {
  return (
    <svg
      data-slot="done-indicator"
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={!props["aria-label"]}
      {...props}
      className={cn("text-emerald-600 dark:text-emerald-400", className)}
    >
      <circle cx={12} cy={12} r={9} fill="currentColor" fillOpacity={0.15} stroke="none" />
      <path d="m7.5 12 3 3 6-6" />
    </svg>
  );
}
