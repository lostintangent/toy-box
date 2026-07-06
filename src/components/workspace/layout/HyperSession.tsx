import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Maximize2, Minus, X } from "lucide-react";
import { SessionPager } from "./SessionPager";
import type { SessionPaneProps } from "@/components/workspace/panes/session/SessionPane";
import {
  SESSION_OVERLAY_BASE_CLASS,
  VIEWPORT_OVERLAY_BOUNDS,
  clampViewportOverlayPosition,
  type OverlayPosition,
} from "@/components/workspace/overlayWindow";
import { useLinkedPanes } from "@/hooks/session/useLinkedPanes";
import { useWorkspaceFocus } from "@/hooks/workspace/useWorkspaceFocus";
import { WorkspaceKindProvider } from "@/hooks/workspace/context";
import { deriveVisibleWorkspacePanes } from "@/lib/workspace/panes";
import type { HyperSessionState } from "@/hooks/session/useHyperSessions";
import { cn } from "@/lib/utils";

// The hyper deck is a swipeable pager, not a fixed 2×2, so it can page through
// more than the grid's four visible panes.
const HYPER_DECK_MAX_PANES = 6;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  position: OverlayPosition;
};

export interface HyperSessionProps extends Omit<
  SessionPaneProps,
  "sessionId" | "mode" | "onBack" | "isSessionRunning" | "isSessionUnread"
> {
  state: HyperSessionState;
  setHyperSession: Dispatch<SetStateAction<HyperSessionState | null>>;
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  onClose: (sessionId: string) => void;
  onMinimize: () => void;
  onPromote: (sessionId: string) => void;
}

function TrafficLight({
  label,
  className,
  children,
  onClick,
}: {
  label: string;
  className: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        "group/light flex h-3 w-3 items-center justify-center rounded-full border border-black/10",
        className,
      )}
    >
      <span className="opacity-0 transition-opacity group-hover/light:opacity-80">{children}</span>
    </button>
  );
}

export function HyperSession({
  state,
  setHyperSession,
  streamingSessionIds,
  unreadSessionIds,
  onClose,
  onMinimize,
  onPromote,
  ...sessionViewProps
}: HyperSessionProps) {
  const dragRef = useRef<DragState | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // The pager portals its toolbar (dots + the active pane's actions) into this
  // title-bar element, so the deck's chrome sits on the window bar next to the
  // traffic lights rather than floating over the content.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleResize = () => {
      // A live drag clamps every move itself; let it win until release.
      if (dragRef.current) return;
      setHyperSession((current) =>
        current
          ? { ...current, position: clampViewportOverlayPosition(current.position) }
          : current,
      );
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setHyperSession]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();

      event.currentTarget.setPointerCapture(event.pointerId);

      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: state.position.x,
        originY: state.position.y,
        position: state.position,
      };
    },
    [state.position],
  );

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();

    const nextPosition = clampViewportOverlayPosition({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });

    drag.position = nextPosition;
    const surface = surfaceRef.current;
    if (surface) {
      surface.style.left = `${nextPosition.x}px`;
      surface.style.top = `${nextPosition.y}px`;
    }
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      dragRef.current = null;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      setHyperSession((current) =>
        current?.sessionId === state.sessionId ? { ...current, position: drag.position } : current,
      );
    },
    [setHyperSession, state.sessionId],
  );

  // The hyper session hosts its own mini-workspace: its interactive session
  // publishes linked panes under its source id, which the pager pages through as
  // a self-contained deck. Promote is what graduates it to the main grid.
  const { linkedPanesBySource, setArtifactPaneMode } = useLinkedPanes();
  const hyperPanes = useMemo(
    () =>
      deriveVisibleWorkspacePanes({
        selectedSessionIds: [state.sessionId],
        linkedPanesBySource,
        maxVisible: HYPER_DECK_MAX_PANES,
      }),
    [linkedPanesBySource, state.sessionId],
  );
  // The deck owns the "hyper" workspace kind (see the WorkspaceKindProvider below).
  useWorkspaceFocus(hyperPanes, "hyper");

  const livePosition = dragRef.current?.position ?? state.position;
  return (
    <div
      ref={surfaceRef}
      data-testid="hyper-session"
      className={cn("fixed z-40 flex flex-col", SESSION_OVERLAY_BASE_CLASS)}
      style={{
        ...VIEWPORT_OVERLAY_BOUNDS,
        left: livePosition.x,
        top: livePosition.y,
      }}
    >
      <div
        className="relative flex h-8 cursor-grab touch-none select-none items-center gap-2 border-b bg-background px-3 active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="flex shrink-0 items-center gap-1.5">
          <TrafficLight
            label="Close hyper session"
            className="bg-red-500"
            onClick={() => onClose(state.sessionId)}
          >
            <X className="h-2 w-2 text-red-950" />
          </TrafficLight>
          <TrafficLight
            label="Minimize hyper session"
            className="bg-hyper-accent"
            onClick={onMinimize}
          >
            <Minus className="h-2 w-2 text-yellow-950" />
          </TrafficLight>
          <TrafficLight
            label="Promote hyper session"
            className="bg-green-500"
            onClick={() => onPromote(state.sessionId)}
          >
            <Maximize2 className="h-2 w-2 text-green-950" />
          </TrafficLight>
        </div>
        <div ref={setToolbarSlot} className="flex min-w-0 flex-1 items-center gap-2" />
      </div>
      <div className="min-h-0 flex-1">
        <WorkspaceKindProvider kind="hyper">
          <SessionPager
            panes={hyperPanes}
            selectedSessionId={state.sessionId}
            streamingSessionIds={streamingSessionIds}
            unreadSessionIds={unreadSessionIds}
            onSetArtifactPaneMode={setArtifactPaneMode}
            toolbarSlot={toolbarSlot}
            {...sessionViewProps}
          />
        </WorkspaceKindProvider>
      </div>
    </div>
  );
}
