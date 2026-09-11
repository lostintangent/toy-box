import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { useViewport } from "@/shared/hooks/useViewport";
import { cn } from "@/shared/utils";

export type SidebarListItemStatus = {
  ariaLabel: string;
  tooltip: string;
  icon: ReactNode;
};

export type SidebarListItemProps = Omit<
  ComponentProps<"button">,
  "children" | "className" | "title"
> & {
  title: string;
  titleContent?: ReactNode;
  icon?: ReactNode;
  time?: ReactNode;
  badge?: ReactNode;
  menuItems: ReactNode;
  menuDisabled?: boolean;
  status?: SidebarListItemStatus;
  isActive?: boolean;
  className?: string;
  buttonClassName?: string;
  titleClassName?: string;
};

export function SidebarListItem({
  title,
  titleContent,
  icon,
  time,
  badge,
  menuItems,
  menuDisabled = false,
  status,
  isActive = false,
  className,
  buttonClassName,
  titleClassName,
  ...props
}: SidebarListItemProps) {
  return (
    <SidebarListItemLayout
      isActive={isActive}
      className={className}
      action={
        <SidebarListItemAction title={title} status={status} menuDisabled={menuDisabled}>
          {menuItems}
        </SidebarListItemAction>
      }
    >
      <SidebarListItemButton
        {...props}
        title={title}
        titleContent={titleContent}
        icon={icon}
        time={time}
        badge={badge}
        isActive={isActive}
        buttonClassName={buttonClassName}
        titleClassName={titleClassName}
      />
    </SidebarListItemLayout>
  );
}

export function SidebarListItemLayout({
  isActive,
  isHighlighted = false,
  className,
  action,
  children,
}: {
  isActive: boolean;
  isHighlighted?: boolean;
  className?: string;
  action: ReactNode;
  children: ReactNode;
}) {
  const { hydrated, isMobile } = useViewport();
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive || !hydrated || isMobile) return;
    itemRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [hydrated, isActive, isMobile]);

  return (
    <div
      ref={itemRef}
      className={cn(
        "flex items-center justify-between rounded-lg px-2 py-2 transition-colors [--surface-background:var(--color-panel)]",
        isActive
          ? "bg-(--surface-background) ring-1 ring-border/70 [--surface-background:color-mix(in_srgb,var(--color-foreground)_24%,var(--color-panel))]"
          : isHighlighted
            ? "bg-(--surface-background) [--surface-background:color-mix(in_srgb,var(--color-foreground)_14%,var(--color-panel))]"
            : "hover:bg-(--surface-background) hover:[--surface-background:color-mix(in_srgb,var(--color-foreground)_14%,var(--color-panel))]",
        className,
      )}
    >
      {children}
      {action}
    </div>
  );
}

export function SidebarListItemButton({
  title,
  titleContent,
  icon,
  time,
  badge,
  isActive,
  buttonClassName,
  titleClassName,
  ...props
}: Omit<SidebarListItemProps, "className" | "menuDisabled" | "menuItems" | "status"> & {
  isActive: boolean;
}) {
  return (
    <button
      {...props}
      aria-current={isActive ? "page" : undefined}
      className={cn("mr-2 min-w-0 flex-1 text-left", buttonClassName)}
    >
      <ScrollableFade
        className={cn("flex items-center gap-1.5 whitespace-nowrap text-sm", titleClassName)}
      >
        {icon}
        <span className="min-h-[1lh] shrink-0">{titleContent ?? title}</span>
      </ScrollableFade>
      {(time || badge) && (
        <span className="mt-1 flex min-w-0 items-center gap-1.5">
          {time && (
            <span className="shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-foreground/70">
              {time}
            </span>
          )}
          {badge}
        </span>
      )}
    </button>
  );
}

export function SidebarListItemAction({
  title,
  status,
  menuDisabled,
  children,
}: {
  title: string;
  status?: SidebarListItemStatus;
  menuDisabled: boolean;
  children: ReactNode;
}) {
  if (status) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              role="status"
              className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center"
              aria-label={status.ariaLabel}
            >
              {status.icon}
            </div>
          }
        />
        <TooltipContent sideOffset={6}>{status.tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <SidebarListItemMenu title={title} disabled={menuDisabled}>
      {children}
    </SidebarListItemMenu>
  );
}

function SidebarListItemMenu({
  title,
  disabled,
  children,
}: {
  title: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled}
            className="ml-2 h-8 w-8 shrink-0"
            aria-label={`Actions for ${title}`}
          />
        }
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
