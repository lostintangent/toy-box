import { Children, isValidElement, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
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
  listClassName,
  emptyState,
  rootClassName,
  scrollbar,
}: {
  children?: ReactNode;
  className?: string;
  listClassName?: string;
  emptyState?: ReactNode;
  rootClassName?: string;
  scrollbar?: boolean;
}) {
  // Children.map carries each feature-owned key onto the motion list entry.
  // Entries measure only when membership or order changes, so list renders for
  // selection or status don't force a layout read of every row.
  const items = Children.toArray(children);
  const order = items.map((child) => (isValidElement(child) ? child.key : null)).join();
  const entries = Children.map(items, (child) => (
    <m.li {...listEntryMotion} layoutDependency={order}>
      {child}
    </m.li>
  ));

  return (
    <MotionScrollableFade
      layoutScroll
      axis="vertical"
      rootClassName={cn("min-w-0", rootClassName)}
      className={className}
      scrollbar={scrollbar}
    >
      <ul className={cn("relative flex flex-col gap-2", listClassName)}>
        <AnimatePresence initial={false} mode="popLayout">
          {entries.length > 0
            ? entries
            : emptyState && (
                <m.li key="sidebar-list-empty" {...listEntryMotion}>
                  {emptyState}
                </m.li>
              )}
        </AnimatePresence>
      </ul>
    </MotionScrollableFade>
  );
}
