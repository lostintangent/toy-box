import { useCallback, useEffect, memo, useState } from "react";
import { terminalManager } from "@/lib/terminal/terminalManager";
import { DEFAULT_TERMINAL_WS_PORT } from "@/types";

import "@xterm/xterm/css/xterm.css";

export interface TerminalProps {
  onClose?: () => void;
  isResizing?: boolean;
  wsPort?: number;
}

export const Terminal = memo(function ({
  onClose,
  isResizing = false,
  wsPort = DEFAULT_TERMINAL_WS_PORT,
}: TerminalProps) {
  const [isPtyReady, setIsPtyReady] = useState(false);

  const terminalRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) {
        terminalManager.detach();
        return;
      }

      terminalManager.attach(
        node,
        {
          onReady: setIsPtyReady,
          onClose,
        },
        wsPort,
      );
    },
    [onClose, wsPort],
  );

  // Debounce PTY resizing while the user is actively resizing the panel
  useEffect(() => {
    terminalManager.setResizePaused(isResizing);
    return () => {
      terminalManager.setResizePaused(false);
    };
  }, [isResizing]);

  return (
    <div className="relative h-full min-h-0 p-2 pb-0">
      <div ref={terminalRefCallback} className="h-full w-full" />

      {/* Loading skeleton (fades in after delay so quick reconnects don't flash) */}
      {!isPtyReady && (
        <div className="absolute inset-0 flex items-start p-2 bg-terminal-bg opacity-0 animate-in fade-in fill-mode-forwards delay-200">
          <span className="inline-block w-2.5 h-5 bg-foreground animate-pulse duration-1000" />
        </div>
      )}
    </div>
  );
});
