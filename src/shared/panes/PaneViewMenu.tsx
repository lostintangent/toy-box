import type { LucideIcon } from "lucide-react";
import { usePaneVariant } from "./PaneSlots";
import { PANE_OVERLAY_BUTTON_CLASS, PANE_OVERLAY_ICON_CLASS } from "./paneControls";
import { buttonVariants } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

export function PaneViewMenu<View extends string>({
  view,
  views,
  onViewChange,
}: {
  view: View;
  views: readonly { value: View; label: string; Icon: LucideIcon }[];
  onViewChange: (view: View) => void;
}) {
  const { label, Icon } = views.find(({ value }) => value === view)!;
  const triggerLabel = `Showing ${label.toLowerCase()}`;
  const isNormal = usePaneVariant() === "normal";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label={triggerLabel}
        title={triggerLabel}
        className={
          isNormal
            ? PANE_OVERLAY_BUTTON_CLASS
            : buttonVariants({ variant: "ghost", size: "icon-sm" })
        }
      >
        <Icon className={isNormal ? PANE_OVERLAY_ICON_CLASS : undefined} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" finalFocus={false}>
        <DropdownMenuRadioGroup value={view} onValueChange={onViewChange}>
          {views.map(({ value, label, Icon: OptionIcon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="gap-2 text-xs">
              <OptionIcon className="size-3.5 text-muted-foreground" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
