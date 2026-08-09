import { useState, type ReactNode } from "react";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { useViewport } from "@/shared/hooks/useViewport";
import { VIEWPORT_OVERLAY_BOUNDS } from "@workspace/components/overlayWindow";
import { SessionPane } from "./SessionPane";

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
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  sessionId: string;
  open: boolean;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  onMouseEnter: (event: React.MouseEvent) => void;
  onMouseLeave: () => void;
  children: ReactNode;
}) {
  return (
    <Popover open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={5}
        className="hidden p-0 md:block"
        style={VIEWPORT_OVERLAY_BOUNDS}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <SessionPane key={sessionId} sessionId={sessionId} mode="passive" />
      </PopoverContent>
    </Popover>
  );
}
