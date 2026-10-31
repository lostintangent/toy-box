import { Hand, Keyboard, MonitorPause, MonitorX } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { PaneMessage } from "@/shared/ui/pane-message";
import { PaneActions } from "@/shared/panes/PaneSlots";
import { useScreen } from "./useScreen";
import { useScreenKeyboard } from "./useScreenKeyboard";
import { useScreenPointer } from "./useScreenPointer";

/** A live display or window that the viewer can zoom, and control while it's theirs. */
export function ScreenPane({
  screenId,
  isVisible = true,
}: {
  screenId: string;
  isVisible?: boolean;
}) {
  const screen = useScreen(screenId, isVisible);
  useScreenPointer(screen);
  const { textareaRef, showKeyboard } = useScreenKeyboard(screen);
  const { canvasRef, status, title, error, hasControl } = screen;

  return (
    <div className="flex h-full min-h-0 flex-col" data-screen-id={screenId}>
      <PaneActions>
        <Button
          size="icon-sm"
          title={hasControl ? "Release control" : "Control the host screen"}
          aria-label={hasControl ? "Release control" : "Take control"}
          aria-pressed={hasControl}
          variant={hasControl ? "secondary" : "ghost"}
          className={hasControl ? undefined : "md:bg-background/90"}
          disabled={status !== "live"}
          onClick={hasControl ? screen.releaseControl : screen.takeControl}
        >
          <Hand className="size-3.5" />
        </Button>
        {hasControl && (
          <Button
            size="icon-sm"
            variant="ghost"
            title="Show keyboard"
            aria-label="Show keyboard"
            className="md:bg-background/90"
            onClick={showKeyboard}
          >
            <Keyboard className="size-3.5" />
          </Button>
        )}
      </PaneActions>
      {error && (
        <p
          role="alert"
          className="shrink-0 border-b border-destructive/30 px-3 py-2 text-xs text-destructive md:pr-[calc(var(--toybox-pane-actions-inset,0px)+5rem)]"
        >
          {error}
        </p>
      )}
      <div className="relative min-h-0 flex-1 touch-none overflow-hidden bg-background">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label={`Live screen: ${title ?? screenId}`}
          className="h-full w-full touch-none object-contain outline-none"
        />
        {hasControl && (
          <textarea
            ref={textareaRef}
            aria-label="Type in screen"
            tabIndex={-1}
            maxLength={4097}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            wrap="off"
            className="pointer-events-none absolute top-0 left-0 h-4 w-px resize-none overflow-hidden p-0 text-base leading-none opacity-0"
          />
        )}
        {status !== "live" && (
          <div role="status" className="absolute inset-0">
            <ScreenMessage screen={screen} />
          </div>
        )}
      </div>
    </div>
  );
}

/** What the pane shows until its screen is live, or once it no longer is. */
function ScreenMessage({ screen }: { screen: ReturnType<typeof useScreen> }) {
  const { status, title, reason, retry } = screen;
  if (status === "paused")
    return (
      <PaneMessage
        icon={MonitorPause}
        title="Screen paused"
        detail={reason ?? "The host has suspended capture."}
      />
    );
  if (status === "ended")
    return (
      <PaneMessage
        icon={MonitorX}
        title={`Unable to show ${title ?? "screen"}`}
        detail={reason ?? "This screen is no longer available."}
      >
        <Button size="sm" variant="outline" onClick={retry}>
          Try again
        </Button>
      </PaneMessage>
    );
  return (
    <PaneMessage
      loading
      title={`Connecting to ${title ?? "screen"}`}
      detail="Waiting for the first frame…"
    />
  );
}
