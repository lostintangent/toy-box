import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/shared/ui/resizable";
import { cn } from "@/shared/utils";
import { TerminalShell } from "@terminal/components/TerminalShell";
import { HyperSession, type HyperSessionProps } from "./HyperSession";
import { CARD_CLASS, CARD_INSET_CLASS } from "./card";
import { Sidebar, type SidebarProps } from "@workspace/components/sidebar/Sidebar";
import {
  WorkspaceGrid,
  type WorkspaceGridProps,
} from "@workspace/components/panes/hosts/WorkspaceGrid";

export type DesktopWorkspaceLayoutProps = {
  sidebar: SidebarProps;
  workspace: WorkspaceGridProps;
  terminal: {
    open: boolean;
    size: number;
    body: ReactNode;
    onOpenChange: (open: boolean) => void;
    onSizeChange: (size: number) => void;
  };
  hyper: HyperSessionProps | null;
};

/** Desktop workspace composition: sidebar, pane grid, terminal drawer, and Hyper surface. */
export function DesktopWorkspaceLayout({
  sidebar,
  workspace,
  terminal,
  hyper,
}: DesktopWorkspaceLayoutProps) {
  const { open, size, body, onOpenChange, onSizeChange } = terminal;
  const terminalPanelRef = useRef<ImperativePanelHandle>(null);
  const terminalSizeRef = useRef(size);
  const isTerminalDraggingRef = useRef(false);
  const [isTerminalDragging, setIsTerminalDragging] = useState(false);

  useEffect(() => {
    const panel = terminalPanelRef.current;
    if (!panel) return;
    if (open) {
      if (!Number.isFinite(size)) return;
      panel.resize(size);
    } else {
      panel.resize(0);
    }
  }, [open, size]);

  useEffect(() => {
    terminalSizeRef.current = size;
  }, [size]);

  function handleTerminalResize(nextSize: number) {
    if (nextSize <= 0) return;
    terminalSizeRef.current = nextSize;
    if (!isTerminalDraggingRef.current) onSizeChange(nextSize);
  }

  function handleTerminalDragging(dragging: boolean) {
    isTerminalDraggingRef.current = dragging;
    setIsTerminalDragging(dragging);
    if (dragging) return;

    onSizeChange(terminalSizeRef.current);
  }

  return (
    <div className={cn("hidden h-full bg-backdrop md:flex", CARD_INSET_CLASS)}>
      <Sidebar {...sidebar} />

      <div className="min-w-0 flex-1">
        <ResizablePanelGroup direction="vertical" className="h-full">
          <ResizablePanel order={1} defaultSize={open ? 100 - size : 100}>
            <WorkspaceGrid {...workspace} />
          </ResizablePanel>

          <ResizableHandle
            gap
            disabled={!open}
            onDragging={handleTerminalDragging}
            className={cn(!open && "hidden")}
          />
          <ResizablePanel
            ref={terminalPanelRef}
            id="terminal"
            order={2}
            defaultSize={open ? size : 0}
            minSize={15}
            maxSize={80}
            collapsible
            collapsedSize={0}
            onResize={handleTerminalResize}
            onCollapse={() => onOpenChange(false)}
            onExpand={() => onOpenChange(true)}
            className={!isTerminalDragging ? "transition-[flex-grow] duration-300 ease-layout" : ""}
          >
            <AnimatePresence initial={false}>
              {open && (
                <m.div
                  key="desktop-terminal"
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.3 } }}
                  className={cn("size-full", CARD_INSET_CLASS)}
                >
                  <div className={cn(CARD_CLASS, "h-full")}>
                    <TerminalShell onClose={() => onOpenChange(false)}>{body}</TerminalShell>
                  </div>
                </m.div>
              )}
            </AnimatePresence>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {hyper && <HyperSession {...hyper} />}
    </div>
  );
}
