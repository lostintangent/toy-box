import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

import { cn } from "@/shared/utils";

type SeparatorProps = SeparatorPrimitive.Props & { decorative?: boolean };

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: SeparatorProps) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      role={decorative ? "none" : "separator"}
      aria-orientation={!decorative && orientation === "vertical" ? orientation : undefined}
      className={cn(
        "bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
