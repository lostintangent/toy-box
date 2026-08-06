import { Separator } from "@/components/ui/separator";
import {
  ActionSpacer,
  BrowseFilesButton,
  HyperButton,
  NewSessionButton,
  TerminalToggle,
  type SidebarCreateOptions,
} from "./SidebarActions";
import { SIDEBAR_BORDER, SIDEBAR_COLLAPSED_WIDTH } from "./SidebarResizer";
import { cn } from "@/lib/utils";

/** The rail's separators are the footer's vertical rule turned on its side. */
const SEPARATOR = "my-1.5 h-px! w-4! bg-muted-foreground/50!";

/**
 * The collapsed desktop sidebar: the header and footer rows turned on their side
 * inside a bar one action wide, so the session list gives up its space without
 * taking the sidebar's common actions with it.
 *
 * `Sidebar` pins the collapse toggle and settings actions outside both layouts,
 * so this stack opens and closes with the shapes those actions occupy when
 * expanded, leaving each pin a hole to land in rather than measuring around it.
 */
export function SidebarRail({
  collapsed,
  className,
  onCreateSession,
  onBrowseFiles,
  onToggleHyper,
  isHyperOpen,
  onToggleTerminal,
  isTerminalOpen,
}: {
  collapsed: boolean;
  className?: string;
  onCreateSession: (options?: SidebarCreateOptions) => void;
  onBrowseFiles: () => void;
  onToggleHyper: () => void;
  isHyperOpen: boolean;
  onToggleTerminal: () => void;
  isTerminalOpen: boolean;
}) {
  return (
    <div
      aria-hidden={!collapsed}
      inert={!collapsed}
      // The rail holds the collapsed sidebar's width rather than filling it, so
      // its icons sit on their final pixel from the first frame of a collapse
      // instead of sliding inward as the sidebar narrows.
      style={{ width: SIDEBAR_COLLAPSED_WIDTH - SIDEBAR_BORDER }}
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
      <Separator className={SEPARATOR} />
      <NewSessionButton onCreateSession={onCreateSession} />

      <div className="min-h-0 flex-1" />

      <HyperButton onToggle={onToggleHyper} isOpen={isHyperOpen} />
      <BrowseFilesButton onBrowseFiles={onBrowseFiles} />
      <TerminalToggle isTerminalOpen={isTerminalOpen} onToggleTerminal={onToggleTerminal} />
      <Separator className={SEPARATOR} />
      <ActionSpacer />
    </div>
  );
}
