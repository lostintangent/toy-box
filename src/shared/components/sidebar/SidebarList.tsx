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
} as const;

const MotionScrollableFade = m.create(ScrollableFade);

export function SidebarList({
  children,
  className,
  emptyState,
  rootClassName,
}: {
  children?: ReactNode;
  className?: string;
  emptyState: ReactNode;
  rootClassName?: string;
}) {
  // Children.map carries each feature-owned key onto the motion list entry.
  const entries = Children.map(Children.toArray(children), (child) => (
    <m.li {...listEntryMotion}>{child}</m.li>
  ));

  return (
    <MotionScrollableFade
      layoutScroll
      axis="vertical"
      rootClassName={cn("min-w-0", rootClassName)}
      className={className}
    >
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
    </MotionScrollableFade>
  );
}
