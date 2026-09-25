import { cn } from "@/shared/utils";
import { InkCloud, type Ink, type Reaction } from "./InkCloud";

export type { Ink } from "./InkCloud";

/** A pane before its first message: an idle ink cloud above a caption. */
export function CloudPlaceholder({
  inks,
  reaction,
  title,
  description,
  className,
}: {
  inks: readonly Ink[];
  reaction: Reaction;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-center p-8", className)}>
      <div className="max-w-sm space-y-4 text-center">
        <InkCloud inks={inks} reaction={reaction} className="mx-auto h-44 w-64" />
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}
