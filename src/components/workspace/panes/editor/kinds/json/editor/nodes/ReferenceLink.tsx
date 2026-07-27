import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { Entity } from "../../document";
import { useJsonTheme } from "../../theme";
import { NodePreview } from "./NodePreview";

// A reference rendered as its target: click to jump there, hover to peek at it. The
// preview is a read-only card, so the popover is anchored and hover-controlled rather
// than click-triggered — a click navigates instead of toggling a panel.

const HOVER_DELAY_MS = 300;

export function ReferenceLink({
  text,
  target,
  onJump,
}: {
  text: string;
  target: Entity;
  onJump: () => void;
}) {
  const { accent } = useJsonTheme();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function openAfterDelay() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  }
  function close() {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          onClick={() => {
            close();
            onJump();
          }}
          onMouseEnter={openAfterDelay}
          onMouseLeave={close}
          onBlur={close}
          className="min-w-0 cursor-pointer truncate underline-offset-2 hover:underline"
          style={{ color: accent }}
          title="Jump to definition"
        >
          {text}
          <ArrowUpRight className="ml-0.5 inline size-3 align-middle" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-fit max-w-sm p-2"
      >
        <NodePreview node={target.node} />
      </PopoverContent>
    </Popover>
  );
}
