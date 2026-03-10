import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Settings, SquareTerminal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TERMINAL_SHELL_STORAGE_KEY, getStoredTerminalShell } from "@/lib/terminal/settings";

export interface SidebarFooterProps {
  onToggleTerminal?: () => void;
  isTerminalOpen?: boolean;
}

export function SidebarFooter({ onToggleTerminal, isTerminalOpen }: SidebarFooterProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shellDraft, setShellDraft] = useState("");

  useEffect(() => {
    if (settingsOpen) {
      setShellDraft(getStoredTerminalShell() ?? "");
    }
  }, [settingsOpen]);

  const handleSave = () => {
    if (typeof window === "undefined") {
      setSettingsOpen(false);
      return;
    }
    const nextValue = shellDraft.trim();
    try {
      if (nextValue.length === 0) {
        window.localStorage.removeItem(TERMINAL_SHELL_STORAGE_KEY);
      } else {
        window.localStorage.setItem(TERMINAL_SHELL_STORAGE_KEY, nextValue);
      }
    } catch {
      // Ignore storage errors
    }
    setSettingsOpen(false);
  };

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
        <div className="grid gap-2">
          <label htmlFor="terminal-shell" className="text-sm font-medium text-foreground">
            Terminal shell
          </label>
          <Input
            id="terminal-shell"
            value={shellDraft}
            onChange={(event) => setShellDraft(event.target.value)}
            placeholder="/bin/zsh or zsh"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            Provide a full path or a binary on your PATH. Close and reopen the terminal to apply.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
