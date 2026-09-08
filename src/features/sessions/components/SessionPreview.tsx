import { lazy, Suspense, useState, type ReactElement } from "react";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { useViewport } from "@/shared/hooks/useViewport";
import { VIEWPORT_OVERLAY_BOUNDS } from "@workspace/components/overlayWindow";

const PreviewSessionPane = lazy(() =>
  import("./SessionPane").then(({ SessionPane }) => ({ default: SessionPane })),
);

export function useSessionPreview(disabled = false) {
  const { isMobile } = useViewport();
  const [open, setOpen] = useState(false);
  const openTask = useDebouncer((nextOpen: boolean) => setOpen(nextOpen), {
    wait: (debouncer) => (debouncer.store.state.lastArgs?.[0] ? 750 : 200),
  });

  const onMouseEnter = (event: React.MouseEvent) => {
    openTask.cancel();
    if (open || disabled || isMobile || event.metaKey || event.ctrlKey) return;
    openTask.maybeExecute(true);
  };

  const onMouseLeave = () => {
    openTask.maybeExecute(false);
  };

  const close = () => {
    openTask.cancel();
    setOpen(false);
  };

  return { open, close, onMouseEnter, onMouseLeave };
}

export function SessionPreview({
  sessionId,
  open,
  side = "right",
  align = "start",
  sideOffset = 5,
  onMouseEnter,
  onMouseLeave,
  nativeButton = true,
  children,
}: {
  sessionId: string;
  open: boolean;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  onMouseEnter: (event: React.MouseEvent) => void;
  onMouseLeave: () => void;
  nativeButton?: boolean;
  children: ReactElement;
}) {
  return (
    <Popover open={open}>
      <PopoverTrigger nativeButton={nativeButton} render={children} />
      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="hidden overflow-hidden p-0 md:block"
        style={VIEWPORT_OVERLAY_BOUNDS}
        initialFocus={false}
        finalFocus={false}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <Suspense>
          <PreviewSessionPane key={sessionId} sessionId={sessionId} mode="passive" />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
