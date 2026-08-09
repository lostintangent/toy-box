import { Children, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { cn } from "@/shared/utils";

const listEntryMotion = {
  layout: "position",
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: {
    duration: 0.16,
    ease: [0.16, 1, 0.3, 1],
    layout: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
  },
} as const;

export function SidebarList({
  children,
  className,
  emptyState,
}: {
  children?: ReactNode;
  className?: string;
  emptyState: ReactNode;
}) {
  // Children.map carries each feature-owned key onto the motion list entry.
  const entries = Children.map(Children.toArray(children), (child) => (
    <m.li {...listEntryMotion}>{child}</m.li>
  ));

  return (
    <ScrollableFade asChild axis="vertical" className={cn("min-w-0", className)}>
      <m.div layoutScroll>
        <ul className="relative flex flex-col gap-2">
          <AnimatePresence initial={false} mode="popLayout">
            {entries.length > 0 ? (
              entries
            ) : (
              <m.li key="sidebar-list-empty" {...listEntryMotion}>
                {emptyState}
              </m.li>
            )}
          </AnimatePresence>
        </ul>
      </m.div>
    </ScrollableFade>
  );
}
