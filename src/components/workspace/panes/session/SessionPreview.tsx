import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useViewport } from "@/hooks/browser/ViewportContext";
import { VIEWPORT_OVERLAY_BOUNDS } from "@/components/workspace/overlayWindow";
import { SessionPane } from "./SessionPane";

export function useSessionPreview(disabled = false) {
  const { isMobile } = useViewport();
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const onMouseEnter = (event: React.MouseEvent) => {
    clearTimer();
    if (open || disabled || isMobile || event.metaKey || event.ctrlKey) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setOpen(true);
    }, 750);
  };

  const onMouseLeave = () => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setOpen(false);
    }, 200);
  };

  const close = () => {
    clearTimer();
    setOpen(false);
  };

  useEffect(() => () => clearTimer(), []);

  return { open, close, onMouseEnter, onMouseLeave };
}

export function SessionPreview({
  sessionId,
  open,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  sessionId: string;
  open: boolean;
  onMouseEnter: (event: React.MouseEvent) => void;
  onMouseLeave: () => void;
  children: ReactNode;
}) {
  return (
    <Popover open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
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
