import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function MetadataBadge({ className, ...props }: ComponentProps<typeof Badge>) {
  return (
    <Badge
      variant="secondary"
      className={cn("h-5 gap-1 px-1.5 py-0 text-[11px]", className)}
      {...props}
    />
  );
}
