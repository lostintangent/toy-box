import type { ComponentProps, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

type SidebarListItemShellProps = {
  isActive?: boolean;
  isHovered?: boolean;
  action?: ReactNode;
  className?: string;
  itemRef?: Ref<HTMLDivElement>;
  children: ReactNode;
};

export function SidebarListItemShell({
  isActive = false,
  isHovered = false,
  action,
  className,
  itemRef,
  children,
}: SidebarListItemShellProps) {
  return (
    <div
      ref={itemRef}
      className={cn(
        "flex items-center justify-between rounded-lg px-2 py-2 transition-colors",
        isActive
          ? "bg-foreground/24 ring-1 ring-border/70"
          : isHovered
            ? "bg-foreground/14"
            : "hover:bg-foreground/14",
        className,
      )}
    >
      {children}
      {action}
    </div>
  );
}

type SidebarListItemMainButtonProps = Omit<ComponentProps<"button">, "children"> & {
  headline: ReactNode;
  headlineClassName?: string;
  headlineRef?: Ref<HTMLDivElement>;
  onHeadlineScroll?: ComponentProps<"div">["onScroll"];
  onHeadlinePointerEnter?: ComponentProps<"div">["onPointerEnter"];
  secondary?: ReactNode;
  secondaryEnd?: ReactNode;
  secondaryClassName?: string;
};

export function SidebarListItemMainButton({
  headline,
  headlineClassName,
  headlineRef,
  onHeadlineScroll,
  onHeadlinePointerEnter,
  secondary,
  secondaryEnd,
  secondaryClassName,
  className,
  ...props
}: SidebarListItemMainButtonProps) {
  return (
    <button className={cn("mr-2 min-w-0 flex-1 text-left", className)} {...props}>
      <div
        ref={headlineRef}
        onScroll={onHeadlineScroll}
        onPointerEnter={onHeadlinePointerEnter}
        className={cn("overflow-x-auto whitespace-nowrap sidebar-scroll-fade", headlineClassName)}
      >
        {headline}
      </div>
      {(secondary || secondaryEnd) && (
        <div
          className={cn(
            "mt-1 flex min-w-0 items-center gap-2",
            secondaryEnd && "justify-between",
            secondaryClassName,
          )}
        >
          <div className="flex min-w-0 items-center gap-1.5">{secondary}</div>
          {secondaryEnd && <div className="shrink-0">{secondaryEnd}</div>}
        </div>
      )}
    </button>
  );
}
