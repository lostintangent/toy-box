import { AutomationPanel } from "@automations/components/AutomationPanel";
import { cn } from "@/shared/utils";
import type { Session } from "@sessions/model";
import type { SessionFilters } from "@sessions/components/sidebar/sessionFilters";
import { AppsPanel } from "@apps/components/AppsPanel";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarRail } from "./SidebarRail";
import { SidebarResizer } from "./SidebarResizer";
import { ActionSpacer, CollapseToggle, SettingsButton } from "./SidebarActions";
import { SessionList } from "@sessions/components/sidebar/SessionList";
import { ChannelsPanel } from "@channels/components/sidebar/ChannelsPanel";
import { sidebarPanelsSchema, type SidebarPanels } from "@workspace/model/config/layoutPrefs";
import { useLayoutPref } from "@workspace/hooks/layout/layoutPrefs";

/**
 * Crossfade one of the sidebar's two layouts. Whichever layout is leaving clears
 * out quickly, so the narrowing sidebar never shows squeezed content, and the
 * arriving one lands as the width settles.
 */
function layerClass(visible: boolean): string {
  return cn(
    "transition-opacity ease-out motion-reduce:transition-none",
    visible ? "opacity-100 delay-150 duration-200" : "pointer-events-none opacity-0 duration-100",
  );
}

export type SidebarProps = {
  filter: SessionFilters;
  onFilterChange: (value: SessionFilters) => void;

  sessions: Session[];
  worktreeSessionIds: string[];
  emptyMessage?: string;

  onAppOpenInHyper: (appId: string) => void;

  /**
   * Desktop only. A collapsible sidebar resizes and collapses to its rail, while
   * one that can't fills a phone's screen and expands one panel at a time.
   */
  collapsible?: boolean;

  className?: string;
};

/**
 * The sidebar presents two layouts over one origin: the expanded rows and, on
 * desktop, the collapsed rail. They crossfade rather than swap, and the collapse
 * toggle and settings actions are pinned outside both so the two states share
 * their exact position and the morph reads as content leaving, not chrome
 * moving. The pinned actions replace nothing on mobile, where the sidebar is the
 * whole screen and never collapses.
 */
export function Sidebar({
  filter,
  onFilterChange,

  sessions,
  worktreeSessionIds,
  emptyMessage,

  onAppOpenInHyper,

  collapsible,
  className,
}: SidebarProps) {
  // Only a collapsible sidebar pins the collapse toggle and settings actions
  // outside its two layouts, and only it has a rail for them to head and foot.
  const [isCollapsed] = useLayoutPref("sidebarCollapsed");
  const collapsed = !!collapsible && isCollapsed;

  // A sidebar that can't collapse fills a phone's screen, so it expands one panel at a time.
  const [expandedPanels, setExpandedPanels] = useLayoutPref("panels");
  const panels = collapsible ? expandedPanels : firstPanel(expandedPanels);
  const setPanelExpanded = (panel: keyof SidebarPanels, expanded: boolean) =>
    setExpandedPanels({ ...(collapsible && expandedPanels), [panel]: expanded || undefined });

  /*
    The sidebar clips its two layouts; it is never a scroll port. `clip` rather
    than `hidden` keeps it out of `scrollIntoView`'s ancestor walk, so revealing
    a session row in the expanded layout can never scroll the collapsed rail and
    its pinned actions out of view.
  */
  const body = (
    <div className={cn("relative h-full min-w-0 overflow-clip bg-background", className)}>
      {collapsible && (
        <div
          // Pinned to the same inset the header and footer rows pad to, and
          // centered in the same row height the header's controls set, so the
          // toggle lands on one pixel in both layouts.
          className="absolute top-3 left-2.5 z-10 flex h-8 items-center"
        >
          <CollapseToggle />
        </div>
      )}

      <div
        aria-hidden={collapsed}
        inert={collapsed}
        className={cn(
          "absolute inset-y-0 left-0 grid w-[var(--sidebar-width,100%)] grid-rows-[auto_1fr_auto] overflow-clip",
          layerClass(!collapsed),
        )}
      >
        <SidebarHeader
          leadingSlot={collapsible ? <ActionSpacer /> : undefined}
          filter={filter}
          onFilterChange={onFilterChange}
          sessionCount={sessions.length}
        />

        <div className="min-h-0 min-w-0 flex flex-col bg-panel">
          <SessionList
            className="px-3 py-2"
            sessions={sessions}
            worktreeSessionIds={worktreeSessionIds}
            emptyMessage={emptyMessage}
          />

          <ChannelsPanel
            isExpanded={panels.channels ?? false}
            onExpandedChange={(expanded) => setPanelExpanded("channels", expanded)}
          />

          <AppsPanel
            isExpanded={panels.apps ?? false}
            onExpandedChange={(expanded) => setPanelExpanded("apps", expanded)}
            onAppOpenInHyper={onAppOpenInHyper}
          />

          <AutomationPanel
            isExpanded={panels.automations ?? false}
            onExpandedChange={(expanded) => setPanelExpanded("automations", expanded)}
          />
        </div>

        <SidebarFooter leadingSlot={collapsible ? <ActionSpacer /> : <SettingsButton />} />
      </div>

      {collapsible && <SidebarRail collapsed={collapsed} className={layerClass(collapsed)} />}

      {collapsible && (
        <div className="absolute bottom-3 left-2.5 z-10 flex">
          <SettingsButton />
        </div>
      )}
    </div>
  );

  return collapsible ? <SidebarResizer>{body}</SidebarResizer> : body;
}

/** The first expanded panel, in sidebar order. */
function firstPanel(panels: SidebarPanels): SidebarPanels {
  const panel = sidebarPanelsSchema.keyof().options.find((key) => panels[key]);
  return panel ? { [panel]: true } : {};
}
