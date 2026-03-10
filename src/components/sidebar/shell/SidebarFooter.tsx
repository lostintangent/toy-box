import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Settings, SquareTerminal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getSettings, updateSetting } from "@/lib/settings";

export interface SidebarFooterProps {
  onToggleTerminal?: () => void;
  isTerminalOpen?: boolean;
}

export function SidebarFooter({ onToggleTerminal, isTerminalOpen }: SidebarFooterProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shell, setShell] = useState("");
  const [useWorktree, setUseWorktree] = useState(false);

  useEffect(() => {
    if (settingsOpen) {
      const s = getSettings();
      setShell(s.terminalShell);
      setUseWorktree(s.useWorktree);
    }
  }, [settingsOpen]);

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <div className="px-3 pt-3 md:pb-3 border-t flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DialogTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          </DialogTrigger>
          <Separator
            orientation="vertical"
            className="h-4! w-px! bg-muted-foreground/50! mx-1 translate-y-px"
          />
          <Link to="/" className="font-bold text-foreground hover:text-primary transition-colors">
            {import.meta.env.VITE_APP_TITLE}
          </Link>
        </div>
        {onToggleTerminal && (
          <Toggle
            pressed={!!isTerminalOpen}
            onPressedChange={() => onToggleTerminal()}
            size="sm"
            className="h-6 w-6 min-w-6 p-0"
            aria-label="Toggle terminal"
            title="Toggle terminal"
          >
            <SquareTerminal className="h-4 w-4" />
          </Toggle>
        )}
      </div>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="terminal-shell" className="text-sm font-medium text-foreground">
              Terminal shell
            </label>
            <Input
              id="terminal-shell"
              value={shell}
              onChange={(event) => setShell(event.target.value)}
              onBlur={() => updateSetting("terminalShell", shell.trim())}
              placeholder="/bin/zsh or zsh"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Provide a full path or a binary on your PATH. Close and reopen the terminal to apply.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="use-worktree"
              checked={useWorktree}
              onCheckedChange={(checked) => {
                const value = checked === true;
                setUseWorktree(value);
                updateSetting("useWorktree", value);
              }}
            />
            <label htmlFor="use-worktree" className="text-sm font-medium text-foreground">
              Start new sessions in a worktree
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
