import { useState, useRef, useCallback } from "react";
import { useViewport } from "@/hooks/browser/ViewportContext";
import { Circle, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { SessionView } from "@/components/session/SessionView";
import { SessionMetadataBadges } from "@/components/session/SessionMetadataBadges";
import { RelativeTime } from "@/components/ui/relative-time";
import type { SessionMetadata } from "@/types";
import { SidebarListItemMainButton, SidebarListItemShell } from "./SidebarListItemShell";
import { useSidebarScrollFade } from "./useSidebarScrollFade";

// ============================================================================
// Session Action (trailing icon / delete button)
// ============================================================================

interface SessionActionProps {
  isStreaming: boolean;
  isUnread: boolean;
  isDraft: boolean;
  isDeleting: boolean;
  onDelete: () => void;
}

const DELETE_BUTTON_CLASS = "ml-2 text-destructive hover:text-destructive hover:bg-destructive/10";

function SessionAction({
  isStreaming,
  isUnread,
  isDraft,
  isDeleting,
  onDelete,
}: SessionActionProps) {
  if (isStreaming) {
    return (
      <div className="ml-2 flex items-center justify-center w-8 h-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isUnread) {
    return (
      <div className="ml-2 flex items-center justify-center w-8 h-8">
        <Circle className="h-2.5 w-2.5 fill-blue-500 text-blue-500" />
      </div>
    );
  }

  // Draft sessions can be deleted immediately without confirmation
  if (isDraft) {
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled={isDeleting}
        className={DELETE_BUTTON_CLASS}
        aria-label="Delete session"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={isDeleting}
          className={DELETE_BUTTON_CLASS}
          aria-label="Delete session"
          onClick={(e) => {
            // Shift+click to delete without confirmation
            if (e.shiftKey) {
              e.preventDefault();
              onDelete();
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete session?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this session and all its messages. This action cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ============================================================================
// Session List Item Component
// ============================================================================

export interface SessionListItemProps {
  session: SessionMetadata;
  onSelect: (sessionId: string | null, modifierKey?: boolean) => void;
  onDelete: () => void;
  isDeleting: boolean;
  isActive?: boolean;
  isStreaming?: boolean;
  isUnread?: boolean;
  isDraft?: boolean;
}

export function SessionListItem({
  session,
  onSelect,
  onDelete,
  isDeleting,
  isActive = false,
  isStreaming = false,
  isUnread = false,
  isDraft = false,
}: SessionListItemProps) {
  const { hydrated, isMobile } = useViewport();
  const allowScrollIntoView = hydrated && !isMobile;
  const { headlineRef, updateScrollFades } = useSidebarScrollFade(session.summary);

  // Hover preview state
  const [showPreview, setShowPreview] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // [GRID-FEATURE] Handle click with Cmd/Ctrl key support for multi-session grid
  const handleClick = (e: React.MouseEvent) => {
    const hasModifier = e.metaKey || e.ctrlKey;

    // Always pass the session ID and modifier state to parent
    // Parent will handle removal from grid if already active
    onSelect(session.sessionId, hasModifier);
  };

  // Handle hover preview
  const handleMouseEnter = (e?: React.MouseEvent) => {
    // Cancel any pending close
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }

    // If already showing, keep it open (but we still needed to clear the timeout above)
    if (showPreview) return;

    // Only enable on desktop
    if (isMobile) return;

    // Don't show preview for already active sessions or drafts
    if (isActive || isDraft) return;

    // Don't show preview when modifier key is held (grid operations)
    if (e?.metaKey || e?.ctrlKey) return;

    // Delay showing preview by 750ms
    hoverTimeoutRef.current = setTimeout(() => {
      setShowPreview(true);
    }, 750);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    // Delay closing to allow moving to the popover
    leaveTimeoutRef.current = setTimeout(() => {
      setShowPreview(false);
    }, 200);
  };

  // Scroll active item into view (centered) - desktop only
  const scrollIntoViewRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !isActive) return;
      if (!allowScrollIntoView) return;
      node.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    },
    [allowScrollIntoView, isActive],
  );
  const showBadges = Boolean(
    session.context?.repository || session.context?.gitRoot || session.context?.cwd,
  );

  return (
    <SidebarListItemShell itemRef={scrollIntoViewRef} isActive={isActive} isHovered={showPreview}>
      <Popover open={showPreview && !isActive}>
        <PopoverTrigger asChild>
          <SidebarListItemMainButton
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            aria-current={isActive ? "page" : undefined}
            headline={session.summary || "New session"}
            headlineRef={headlineRef}
            onHeadlineScroll={updateScrollFades}
            onHeadlinePointerEnter={updateScrollFades}
            headlineClassName={session.summary ? "font-medium" : "italic text-muted-foreground"}
            secondary={
              (!isDraft || showBadges) && (
                <>
                  {!isDraft && (
                    <div className="shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-foreground/70">
                      <RelativeTime date={session.modifiedTime} />
                    </div>
                  )}
                  <SessionMetadataBadges
                    repository={session.context?.repository}
                    gitRoot={session.context?.gitRoot}
                    cwd={session.context?.cwd}
                  />
                </>
              )
            }
          />
        </PopoverTrigger>

        {/* Hover preview - desktop only */}
        <PopoverContent
          side="right"
          align="start"
          sideOffset={5}
          className="w-[450px] h-[600px] p-0 hidden md:block"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <SessionView key={session.sessionId} sessionId={session.sessionId} readOnly={true} />
        </PopoverContent>
      </Popover>

      <SessionAction
        isStreaming={isStreaming}
        isUnread={isUnread}
        isDraft={isDraft}
        isDeleting={isDeleting}
        onDelete={onDelete}
      />
    </SidebarListItemShell>
  );
}
