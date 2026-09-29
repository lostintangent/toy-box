import type { ComponentProps } from "react";
import { cn } from "@/shared/utils";

/** An agent needs input: a soft amber disc and question mark on the same circle as the running arc. */
export function WaitingIndicator({
  className,
  ...props
}: Omit<ComponentProps<"svg">, "ref" | "children">) {
  return (
    <svg
      data-slot="waiting-indicator"
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
      className={cn("text-amber-600 dark:text-amber-400", className)}
    >
      <circle cx={12} cy={12} r={9} fill="currentColor" fillOpacity={0.15} stroke="none" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
    </svg>
  );
}
