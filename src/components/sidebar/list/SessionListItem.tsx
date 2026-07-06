import { useState, useRef, useCallback } from "react";
import { useViewport } from "@/hooks/browser/ViewportContext";
import { Circle, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { SessionPane } from "@/components/workspace/panes/session/SessionPane";
import { VIEWPORT_OVERLAY_BOUNDS } from "@/components/workspace/overlayWindow";
import { SessionMetadataBadges } from "@/components/workspace/panes/session/location/SessionMetadataBadges";
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
  sessionLabel: string;
  onRename?: () => void;
  onDelete: () => void;
}

const ACTION_BUTTON_CLASS = "ml-2 h-8 w-8 shrink-0";

function SessionAction({
  isStreaming,
  isUnread,
  isDraft,
  isDeleting,
  sessionLabel,
  onRename,
  onDelete,
}: SessionActionProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);

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
        <Circle className="h-2.5 w-2.5 fill-unread text-unread" />
      </div>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={isDeleting}
            className={ACTION_BUTTON_CLASS}
            aria-label={`Actions for ${sessionLabel}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={isDraft || !onRename} onSelect={onRename}>
            <Pencil className="h-3.5 w-3.5" />
            Rename session
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={isDeleting}
            onSelect={(event) => {
              event.preventDefault();
              setDeleteOpen(true);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete session
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
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
              onClick={() => {
                onDelete();
                setDeleteOpen(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ============================================================================
// Session List Item Component
// ============================================================================

export interface SessionListItemProps {
  session: SessionMetadata;
  onSelect: (sessionId: string | null, modifierKey?: boolean) => void;
  onRename?: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  isActive?: boolean;
  isStreaming?: boolean;
  isUnread?: boolean;
  isWorktree?: boolean;
  isDraft?: boolean;
}

export function SessionListItem({
  session,
  onSelect,
  onRename,
  onDelete,
  isDeleting,
  isActive = false,
  isStreaming = false,
  isUnread = false,
  isWorktree = false,
  isDraft = false,
}: SessionListItemProps) {
  const { hydrated, isMobile } = useViewport();
  const allowScrollIntoView = hydrated && !isMobile;
  const sessionLabel = session.summary || (isDraft ? "Draft session" : "New session");
  const { headlineRef, updateScrollFades } = useSidebarScrollFade(session.summary);

  // Hover preview state
  const [showPreview, setShowPreview] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cmd/Ctrl toggles a session in the multi-pane workspace.
  const handleClick = (e: React.MouseEvent) => {
    const hasModifier = e.metaKey || e.ctrlKey;

    // Always pass the session ID and modifier state to parent
    // Parent handles removal from the workspace when already active.
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

    // Don't show preview when modifier key is held (workspace selection).
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
    session.context?.repository || session.context?.gitRoot || session.context?.workingDirectory,
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
            headline={sessionLabel}
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
                    cwd={session.context?.workingDirectory}
                    isWorktree={isWorktree}
                  />
                </>
              )
            }
          />
        </PopoverTrigger>

        {/* Hover preview (desktop only) */}
        <PopoverContent
          side="right"
          align="start"
          sideOffset={5}
          className="p-0 hidden md:block"
          style={VIEWPORT_OVERLAY_BOUNDS}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <SessionPane key={session.sessionId} sessionId={session.sessionId} mode="readOnly" />
        </PopoverContent>
      </Popover>

      <SessionAction
        isStreaming={isStreaming}
        isUnread={isUnread}
        isDraft={isDraft}
        isDeleting={isDeleting}
        sessionLabel={sessionLabel}
        onRename={onRename}
        onDelete={onDelete}
      />
    </SidebarListItemShell>
  );
}
