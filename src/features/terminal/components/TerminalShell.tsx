import type { ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";

export type TerminalShellProps = {
  onClose?: () => void;
  children?: ReactNode;
};

const QUICK_KEYS = {
  left: "\x1b[D",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  tab: "\t",
  esc: "\x1b",
  ctrlC: "\x03",
};

type QuickKeyButtonProps = {
  onQuickKey: (data: string) => void;
  keyData: string;
  variant?: "ghost" | "outline";
  size?: "icon-xs" | "xs";
  className?: string;
  label: string;
  children: ReactNode;
};

function QuickKeyButton({
  onQuickKey,
  keyData,
  variant = "ghost",
  size = "icon-xs",
  className,
  label,
  children,
}: QuickKeyButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn("h-6 rounded-none hover:bg-muted/60", size === "icon-xs" && "w-6", className)}
      onClick={() => onQuickKey(keyData)}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

// Keep the xterm-backed client runtime out of the initial application bundle.
function closeTerminal() {
  void import("../client/terminalManager").then(({ terminalManager }) => {
    terminalManager.close();
  });
}

function sendTerminalInput(data: string) {
  void import("../client/terminalManager").then(({ terminalManager }) => {
    terminalManager.sendInput(data);
  });
}

export function TerminalShell({ onClose, children }: TerminalShellProps) {
  function handleClose() {
    closeTerminal();
    onClose?.();
  }

  return (
    <div className="relative flex h-full flex-col bg-terminal-bg group">
      {/* Mobile back button bar */}
      <div className="p-2 pt-0 border-b bg-background md:hidden shrink-0 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={handleClose} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Sessions
        </Button>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-md border border-border bg-muted/40 shadow-xs overflow-hidden">
            <QuickKeyButton
              onQuickKey={sendTerminalInput}
              keyData={QUICK_KEYS.left}
              label="Left arrow"
            >
              <ArrowLeft className="h-3 w-3" />
            </QuickKeyButton>
            <div className="h-4 w-px bg-border/70" />
            <QuickKeyButton onQuickKey={sendTerminalInput} keyData={QUICK_KEYS.up} label="Up arrow">
              <ArrowUp className="h-3 w-3" />
            </QuickKeyButton>
            <div className="h-4 w-px bg-border/70" />
            <QuickKeyButton
              onQuickKey={sendTerminalInput}
              keyData={QUICK_KEYS.down}
              label="Down arrow"
            >
              <ArrowDown className="h-3 w-3" />
            </QuickKeyButton>
            <div className="h-4 w-px bg-border/70" />
            <QuickKeyButton
              onQuickKey={sendTerminalInput}
              keyData={QUICK_KEYS.right}
              label="Right arrow"
            >
              <ArrowRight className="h-3 w-3" />
            </QuickKeyButton>
          </div>
          <div className="flex items-center rounded-md border border-border bg-muted/40 shadow-xs overflow-hidden">
            <QuickKeyButton
              onQuickKey={sendTerminalInput}
              keyData={QUICK_KEYS.tab}
              size="xs"
              className="px-2 text-2xs font-semibold tracking-wide"
              label="Tab"
            >
              Tab
            </QuickKeyButton>
            <div className="h-4 w-px bg-border/70" />
            <QuickKeyButton
              onQuickKey={sendTerminalInput}
              keyData={QUICK_KEYS.esc}
              size="xs"
              className="px-2 text-2xs font-semibold tracking-wide"
              label="Esc"
            >
              Esc
            </QuickKeyButton>
          </div>
          <QuickKeyButton
            onQuickKey={sendTerminalInput}
            keyData={QUICK_KEYS.ctrlC}
            variant="outline"
            size="xs"
            className="px-2 text-2xs font-semibold tracking-wide shadow-xs bg-muted/40 rounded-md"
            label="Ctrl+C"
          >
            Cmd+C
          </QuickKeyButton>
        </div>
      </div>

      {/* Desktop close button (matches WorkspaceGrid styling) */}
      <button
        onClick={handleClose}
        className="absolute top-3 right-3 z-20 hidden md:block bg-background/90 backdrop-blur-sm hover:bg-background border border-border rounded-md p-1.5 shadow-sm hover:shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        aria-label="Close terminal"
      >
        <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
      </button>

      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
