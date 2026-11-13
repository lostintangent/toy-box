import { ChannelsRail } from "@channels/components/sidebar/ChannelsRail";
import {
  ActionSpacer,
  BrowseMenu,
  HyperMenu,
  RailSeparator,
  SidebarSplitButton,
  TerminalToggle,
} from "./SidebarActions";
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_FRAME } from "./SidebarResizer";
import { cn } from "@/shared/utils";

/**
 * The collapsed desktop sidebar: the header and footer rows turned on their side
 * inside a bar one action wide, with the Channels at work between them, so the
 * session list gives up its space without taking the sidebar's common actions
 * with it.
 *
 * `Sidebar` pins the collapse toggle and settings actions outside both layouts,
 * so this stack opens and closes with the shapes those actions occupy when
 * expanded, leaving each pin a hole to land in rather than measuring around it.
 */
export function SidebarRail({ collapsed, className }: { collapsed: boolean; className?: string }) {
  return (
    <div
      aria-hidden={!collapsed}
      inert={!collapsed}
      // The rail holds the collapsed sidebar's width rather than filling it, so
      // its icons sit on their final pixel from the first frame of a collapse
      // instead of sliding inward as the sidebar narrows.
      style={{ width: SIDEBAR_COLLAPSED_WIDTH - SIDEBAR_FRAME }}
      className={cn(
        "absolute inset-y-0 left-0 flex flex-col items-center gap-3 py-3 bg-background",
        className,
      )}
    >
      {/*
        The pinned collapse toggle centers in the header's row, which leaves it
        one step below this inset; the stack then measures from the action
        itself, exactly as the foot does above the settings hole.
      */}
      <ActionSpacer className="mt-1" />
      <RailSeparator />
      <SidebarSplitButton variant="rail" />

      <ChannelsRail />

      <HyperMenu side="right" />
      <BrowseMenu side="right" />
      <TerminalToggle />
      <RailSeparator />
      <ActionSpacer />
    </div>
  );
}
