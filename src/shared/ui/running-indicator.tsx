import type { ComponentProps } from "react";
import { cn } from "@/shared/utils";

/** An agent is doing work: a slow arc on a faint track, turning in step with every other one. */
export function RunningIndicator({
  className,
  ...props
}: Omit<ComponentProps<"svg">, "ref" | "children">) {
  return (
    <svg
      ref={alignToDocumentTimeline}
      data-slot="running-indicator"
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden={!props["aria-label"]}
      {...props}
      className={cn("animate-[spin_1.5s_linear_infinite] motion-reduce:animate-none", className)}
    >
      <circle cx={12} cy={12} r={9} opacity={0.25} />
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  );
}

// Starting every turn at the document's time origin keeps arcs that mount at
// different moments pointing the same way. Under reduced motion there is nothing to align.
function alignToDocumentTimeline(indicator: SVGSVGElement | null) {
  for (const animation of indicator?.getAnimations() ?? []) animation.startTime = 0;
}
