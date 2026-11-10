import type { ReactNode } from "react";
import { TerminalShell } from "@terminal/components/TerminalShell";
import { Sidebar, type SidebarProps } from "@workspace/components/sidebar/Sidebar";
import { useLayoutPref } from "@workspace/hooks/layout/layoutPrefs";
import {
  WorkspacePager,
  type WorkspacePagerProps,
} from "@workspace/components/panes/hosts/WorkspacePager";

type MobileWorkspace = Pick<WorkspacePagerProps, "panes" | "primaryPaneId" | "resolvePaneClose"> & {
  visible: boolean;
  onBack: () => void;
};

export type MobileWorkspaceLayoutProps = {
  hydrated: boolean;
  sidebar: SidebarProps;
  workspace: MobileWorkspace;
  terminal: ReactNode;
};

/** Compact workspace composition: sidebar, pane pager, and terminal overlay. */
export function MobileWorkspaceLayout({
  hydrated,
  sidebar,
  workspace,
  terminal,
}: MobileWorkspaceLayoutProps) {
  const [isTerminalOpen, setIsTerminalOpen] = useLayoutPref("terminalOpen");

  return (
    <div className="relative h-full overflow-clip md:hidden">
      <div
        className={`flex h-full w-[200%] ${hydrated ? "transition-transform duration-300 ease-in-out" : ""}`}
        style={{ transform: workspace.visible ? "translateX(-50%)" : "translateX(0)" }}
      >
        <div className="h-full w-1/2 shrink-0">
          <Sidebar {...sidebar} />
        </div>

        <div className="h-full w-1/2 shrink-0">
          {workspace.visible && (
            <WorkspacePager
              panes={workspace.panes}
              primaryPaneId={workspace.primaryPaneId}
              onBack={workspace.onBack}
              resolvePaneClose={workspace.resolvePaneClose}
            />
          )}
        </div>
      </div>

      <div
        className={`absolute inset-y-0 w-full ${
          hydrated ? "transition-[left] duration-300 ease-in-out" : ""
        } ${isTerminalOpen ? "pointer-events-auto" : "pointer-events-none"}`}
        style={{ left: isTerminalOpen ? "0%" : "100%" }}
      >
        <div className="h-full">
          {isTerminalOpen && (
            <TerminalShell onClose={() => setIsTerminalOpen(false)}>{terminal}</TerminalShell>
          )}
        </div>
      </div>
    </div>
  );
}
