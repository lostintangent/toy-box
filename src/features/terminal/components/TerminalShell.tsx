import { Fragment, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X, type LucideIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils";

export type TerminalShellProps = {
  onClose?: () => void;
  children?: ReactNode;
};

type QuickKey = { label: string; data: string; icon?: LucideIcon };

/** Keys a phone keyboard lacks, in visual groups. A key without an icon shows its label. */
const QUICK_KEYS: QuickKey[][] = [
  [
    { label: "Left arrow", data: "\x1b[D", icon: ArrowLeft },
    { label: "Up arrow", data: "\x1b[A", icon: ArrowUp },
    { label: "Down arrow", data: "\x1b[B", icon: ArrowDown },
    { label: "Right arrow", data: "\x1b[C", icon: ArrowRight },
  ],
  [
    { label: "Tab", data: "\t" },
    { label: "Esc", data: "\x1b" },
  ],
  [{ label: "Ctrl+C", data: "\x03" }],
];

// Keep the xterm-backed client runtime out of the initial application bundle.
function loadTerminalManager() {
  return import("../client/terminalManager").then(({ terminalManager }) => terminalManager);
}

export function TerminalShell({ onClose, children }: TerminalShellProps) {
  function handleClose() {
    void loadTerminalManager().then((terminalManager) => terminalManager.close());
    onClose?.();
  }

  return (
    <div className="relative flex h-full flex-col bg-background group">
      {/* Mobile back button bar */}
      <div className="p-2 pt-0 border-b bg-background md:hidden shrink-0 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={handleClose} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Sessions
        </Button>
        <div className="flex items-center gap-1.5">
          {QUICK_KEYS.map((group) => (
            <div
              key={group[0]!.label}
              className="flex items-center rounded-md border border-border bg-muted/40 shadow-xs overflow-hidden"
            >
              {group.map(({ label, data, icon: Icon }, index) => (
                <Fragment key={label}>
                  {index > 0 && <div className="h-4 w-px bg-border/70" />}
                  <Button
                    type="button"
                    variant="ghost"
                    size={Icon ? "icon-xs" : "xs"}
                    className={cn(
                      "h-6 rounded-none hover:bg-muted/60",
                      Icon ? "w-6" : "px-2 text-2xs font-semibold tracking-wide",
                    )}
                    onClick={() =>
                      void loadTerminalManager().then((terminalManager) =>
                        terminalManager.sendInput(data),
                      )
                    }
                    aria-label={label}
                    title={label}
                  >
                    {Icon ? <Icon className="h-3 w-3" /> : label}
                  </Button>
                </Fragment>
              ))}
            </div>
          ))}
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

      <div className="flex-1 min-h-0 bg-panel">{children}</div>
    </div>
  );
}
