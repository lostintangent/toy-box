import { useAtomValue } from "jotai";
import { Loader2, MessageCirclePlus, Settings, SquareTerminal } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import {
  hasUnreadInboxAtom,
  hyperSessionIdAtom,
  sessionRunningAtom,
} from "@/hooks/workspace/atoms";

export function SidebarFooter({
  onOpenSettings,
  onToggleHyper,
  isHyperOpen,
  onOpenInbox,
  isInboxOpen,
  onToggleTerminal,
  isTerminalOpen,
}: {
  onOpenSettings: () => void;
  onToggleHyper: () => void;
  isHyperOpen: boolean;
  onOpenInbox: () => void;
  isInboxOpen: boolean;
  onToggleTerminal: () => void;
  isTerminalOpen: boolean;
}) {
  const appTitle = import.meta.env.VITE_APP_TITLE;
  const hyperSessionId = useAtomValue(hyperSessionIdAtom);
  const hasUnreadInbox = useAtomValue(hasUnreadInboxAtom);
  const showInboxUnreadIndicator = !isInboxOpen && hasUnreadInbox;

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
        <button
          type="button"
          onClick={onOpenInbox}
          className="relative font-bold text-foreground transition-colors hover:text-primary"
          aria-label={showInboxUnreadIndicator ? `${appTitle}, unread inbox activity` : appTitle}
        >
          {appTitle}
          {showInboxUnreadIndicator && (
            <span
              className="absolute -right-1 top-1 h-2.5 w-2.5 rounded-full bg-unread"
              aria-hidden="true"
            />
          )}
        </button>
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggleHyper}
          className="relative inline-flex h-6 w-6"
          aria-label="Toggle hyper session"
          title="Toggle hyper session"
        >
          {hyperSessionId ? (
            <HyperSessionStatus sessionId={hyperSessionId} isOpen={isHyperOpen} />
          ) : (
            <MessageCirclePlus className="h-4 w-4" />
          )}
        </Button>
        <Toggle
          pressed={isTerminalOpen}
          onPressedChange={() => onToggleTerminal()}
          size="sm"
          className="h-6 w-6 min-w-6 p-0 hover:bg-accent hover:text-accent-foreground"
          aria-label="Toggle terminal"
          title="Toggle terminal"
        >
          <SquareTerminal className="h-4 w-4" />
        </Toggle>
      </div>
    </div>
  );
}

function HyperSessionStatus({ sessionId, isOpen }: { sessionId: string; isOpen: boolean }) {
  const isRunning = useAtomValue(sessionRunningAtom(sessionId));

  return (
    <>
      {isRunning && !isOpen ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <MessageCirclePlus className="h-4 w-4" />
      )}
      {!isRunning && !isOpen && (
        <span className="absolute right-px top-px h-2.5 w-2.5 rounded-full bg-hyper-accent" />
      )}
    </>
  );
}
