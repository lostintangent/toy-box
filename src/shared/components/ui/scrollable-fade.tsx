import { ScrollArea } from "@base-ui/react/scroll-area";
import { forwardRef, type ComponentPropsWithoutRef, type ForwardedRef } from "react";
import { cn } from "@/shared/utils";

export type ScrollableFadeAxis = "horizontal" | "vertical";

const fadeClassName =
  "scroll-fade-8 [--scroll-fade-reveal:2rem] [animation-timing-function:linear]";

type ScrollableFadeProps = ComponentPropsWithoutRef<"div"> & {
  axis?: ScrollableFadeAxis;
  rootClassName?: string;
};

export const ScrollableFade = forwardRef<HTMLElement, ScrollableFadeProps>(function ScrollableFade(
  { axis = "horizontal", className, rootClassName, children, style, ...props },
  forwardedRef,
) {
  const horizontal = axis === "horizontal";

  if (horizontal) {
    return (
      <span
        {...props}
        ref={forwardedRef as ForwardedRef<HTMLSpanElement>}
        data-slot="scrollable-fade"
        data-scrollable-fade="horizontal"
        className={cn(
          fadeClassName,
          "scroll-fade-x no-scrollbar block min-w-0 w-full max-w-full overflow-x-scroll overflow-y-hidden",
          rootClassName,
          className,
        )}
        style={style}
      >
        {children}
      </span>
    );
  }

  return (
    <ScrollArea.Root data-slot="scrollable-fade-root" className={cn("relative", rootClassName)}>
      <ScrollArea.Viewport
        {...props}
        ref={forwardedRef as ForwardedRef<HTMLDivElement>}
        data-slot="scrollable-fade"
        data-scrollable-fade="vertical"
        className={cn(
          fadeClassName,
          "scroll-fade-y focus-visible:ring-ring/50 block rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
          "h-full w-full",
          className,
        )}
        style={{
          overflowX: "hidden",
          overflowY: "scroll",
          ...style,
        }}
      >
        <ScrollArea.Content className="w-full" style={{ minWidth: "100%", width: "100%" }}>
          {children}
        </ScrollArea.Content>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar
        data-slot="scrollable-fade-scrollbar"
        className="pointer-events-none w-2.5 touch-none border-l border-l-transparent p-px opacity-0 transition-[color,opacity] select-none data-[hovering]:pointer-events-auto data-[hovering]:opacity-100 data-[scrolling]:opacity-100"
      >
        <ScrollArea.Thumb
          data-slot="scrollable-fade-thumb"
          className="bg-border relative block w-full rounded-full"
        />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
});
