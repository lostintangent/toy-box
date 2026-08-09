import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { useViewport } from "@/shared/hooks/useViewport";
import { cn } from "@/shared/utils";

export type SidebarListItemProps = Omit<
  ComponentProps<"button">,
  "children" | "className" | "title"
> & {
  title: string;
  icon?: ReactNode;
  time?: ReactNode;
  badge?: ReactNode;
  menuItems: ReactNode;
  menuDisabled?: boolean;
  isActive?: boolean;
  className?: string;
  buttonClassName?: string;
  titleClassName?: string;
};

export function SidebarListItem({
  title,
  icon,
  time,
  badge,
  menuItems,
  menuDisabled = false,
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
        <SidebarListItemMenu title={title} disabled={menuDisabled}>
          {menuItems}
        </SidebarListItemMenu>
      }
    >
      <SidebarListItemButton
        {...props}
        title={title}
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
        "flex items-center justify-between rounded-lg px-2 py-2 transition-colors",
        isActive
          ? "bg-foreground/24 ring-1 ring-border/70"
          : isHighlighted
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

export function SidebarListItemButton({
  title,
  icon,
  time,
  badge,
  isActive,
  buttonClassName,
  titleClassName,
  ...props
}: Omit<SidebarListItemProps, "className" | "menuDisabled" | "menuItems"> & {
  isActive: boolean;
}) {
  return (
    <button
      {...props}
      aria-current={isActive ? "page" : undefined}
      className={cn("mr-2 min-w-0 flex-1 text-left", buttonClassName)}
    >
      <ScrollableFade
        asChild
        className={cn("flex items-center gap-1.5 whitespace-nowrap", titleClassName)}
      >
        <span>
          {icon}
          <span className="shrink-0">{title}</span>
        </span>
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

export function SidebarListItemMenu({
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
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="ml-2 h-8 w-8 shrink-0"
          aria-label={`Actions for ${title}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
