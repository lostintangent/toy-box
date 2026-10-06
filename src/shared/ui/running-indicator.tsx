import type { ComponentProps } from "react";
import { cn } from "@/shared/utils";

/** An agent is doing work: a slow arc on a faint track, turning in step with every other one. While
 *  it waits on the user, the arc holds still and turns amber, its track raised in dark mode so the
 *  bright arc still reads as part of a ring. */
export function RunningIndicator({
  waiting = false,
  className,
  ...props
}: Omit<ComponentProps<"svg">, "ref" | "children"> & { waiting?: boolean }) {
  return (
    <svg
      // Remounting when the arc starts turning again realigns it with every other one.
      key={waiting ? "waiting" : "running"}
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
      className={cn(
        !waiting && "animate-[spin_1.5s_linear_infinite] motion-reduce:animate-none",
        className,
      )}
    >
      <circle cx={12} cy={12} r={9} opacity={0.25} className={cn(waiting && "dark:opacity-40")} />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        className={cn(waiting && "stroke-amber-600 dark:stroke-amber-400")}
      />
    </svg>
  );
}

/** Outlines a card that's waiting on the user. */
export const waitingOutlineClassName = "border-amber-500/40 ring-[3px] ring-amber-500/10";

// Starting every turn at the document's time origin keeps arcs that mount at
// different moments pointing the same way. Under reduced motion there is nothing to align.
function alignToDocumentTimeline(indicator: SVGSVGElement | null) {
  for (const animation of indicator?.getAnimations() ?? []) animation.startTime = 0;
}
