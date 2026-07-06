import { Link } from "@tanstack/react-router";
import { MessageCirclePlus, Settings, SquareTerminal } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";

export interface SidebarFooterProps {
  onOpenSettings: () => void;
  onToggleHyper?: () => void;
  isHyperOpen?: boolean;
  hasHyperSessions?: boolean;
  onToggleTerminal?: () => void;
  isTerminalOpen?: boolean;
}

export function SidebarFooter({
  onOpenSettings,
  onToggleHyper,
  isHyperOpen,
  hasHyperSessions,
  onToggleTerminal,
  isTerminalOpen,
}: SidebarFooterProps) {
  return (
    <div className="px-3 pt-3 md:pb-3 border-t flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Separator
          orientation="vertical"
          className="h-4! w-px! bg-muted-foreground/50! mx-1 translate-y-px"
        />
        <Link to="/" className="font-bold text-foreground hover:text-primary transition-colors">
          {import.meta.env.VITE_APP_TITLE}
        </Link>
      </div>
      <div className="flex items-center gap-3">
        {onToggleHyper && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggleHyper}
            className="relative inline-flex h-6 w-6"
            aria-label="Toggle hyper session"
            title="Toggle hyper session"
          >
            <MessageCirclePlus className="h-4 w-4" />
            {hasHyperSessions && !isHyperOpen && (
              <span className="absolute right-px top-px h-2.5 w-2.5 rounded-full bg-hyper-accent" />
            )}
          </Button>
        )}
        {onToggleTerminal && (
          <Toggle
            pressed={!!isTerminalOpen}
            onPressedChange={() => onToggleTerminal()}
            size="sm"
            className="h-6 w-6 min-w-6 p-0 hover:bg-accent hover:text-accent-foreground"
            aria-label="Toggle terminal"
            title="Toggle terminal"
          >
            <SquareTerminal className="h-4 w-4" />
          </Toggle>
        )}
      </div>
    </div>
  );
}
