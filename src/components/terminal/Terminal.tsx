import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { terminalManager } from "@/lib/terminal/terminalManager";
import { DEFAULT_TERMINAL_WS_PORT } from "@/types";
import { useWorkspaceSelector } from "@/hooks/workspace/state";

import "@xterm/xterm/css/xterm.css";

export interface TerminalProps {
  onClose?: () => void;
  isResizing?: boolean;
  wsPort?: number;
}

export function Terminal({
  onClose,
  isResizing = false,
  wsPort = DEFAULT_TERMINAL_WS_PORT,
}: TerminalProps) {
  const [isPtyReady, setIsPtyReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalShell = useWorkspaceSelector((workspace) => workspace.settings.terminalShell);
  const handleClose = useEffectEvent(() => onClose?.());

  useLayoutEffect(() => {
    terminalManager.setShell(terminalShell);
  }, [terminalShell]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    return terminalManager.attach(
      container,
      {
        onReady: setIsPtyReady,
        onClose: () => handleClose(),
      },
      wsPort,
    );
  }, [wsPort]);

  // Debounce PTY resizing while the user is actively resizing the panel
  useEffect(() => {
    terminalManager.setResizePaused(isResizing);
    return () => {
      terminalManager.setResizePaused(false);
    };
  }, [isResizing]);

  return (
    <div className="relative h-full min-h-0 p-2 pb-0">
      <div ref={containerRef} className="h-full w-full" />

      {/* Loading skeleton (fades in after delay so quick reconnects don't flash) */}
      {!isPtyReady && (
        <div className="absolute inset-0 flex items-start p-2 bg-terminal-bg opacity-0 animate-in fade-in fill-mode-forwards delay-200">
          <span className="inline-block w-2.5 h-5 bg-foreground animate-pulse duration-1000" />
        </div>
      )}
    </div>
  );
}
