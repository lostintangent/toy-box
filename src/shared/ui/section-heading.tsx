import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { Badge } from "./badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";

type SectionHeadingProps = {
  title: string;
  icon?: LucideIcon;
  badge?: number | string;
  detail?: ReactNode;
  badgeToggle?: {
    label: string;
    pressed: boolean;
    onToggle: () => void;
  };
};

export function SectionHeading({
  title,
  icon: Icon,
  badge,
  detail,
  badgeToggle,
  collapsible,
}: SectionHeadingProps & {
  /** Inside a `CollapsibleSection`, the whole row toggles the section, except its own controls. */
  collapsible?: boolean;
}) {
  const label = (
    <>
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="section-heading whitespace-nowrap">{title}</span>
    </>
  );

  return (
    <h3
      data-slot="section-heading"
      className="relative flex min-h-4.5 flex-wrap items-center gap-1.5"
    >
      {/* The trigger's overlay covers the row, and positioned controls paint above it. */}
      {collapsible ? (
        <CollapsibleTrigger className="peer flex cursor-pointer items-center gap-1.5 rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring">
          {label}
        </CollapsibleTrigger>
      ) : (
        label
      )}
      {badge != null && (
        <Badge
          variant="count"
          className={badgeToggle && "relative cursor-pointer hover:text-foreground"}
          render={
            badgeToggle ? (
              <button
                type="button"
                aria-label={badgeToggle.label}
                aria-pressed={badgeToggle.pressed}
                title={badgeToggle.label}
                onClick={badgeToggle.onToggle}
              />
            ) : undefined
          }
        >
          {badge}
          {badgeToggle?.pressed && (
            <span aria-hidden className="size-1.5 rounded-full bg-blue-500 dark:bg-blue-400" />
          )}
        </Badge>
      )}
      {collapsible && (
        <ChevronRight
          aria-hidden
          className="pointer-events-none size-3.5 text-muted-foreground transition-transform peer-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
      )}
      {detail && (
        <span className="relative ms-auto inline-flex shrink-0 items-center gap-2">{detail}</span>
      )}
    </h3>
  );
}

/** A titled section whose heading collapses its content. Open state lives only in the mounted
 *  section, so each starts at `defaultOpen`. */
export function CollapsibleSection({
  defaultOpen = true,
  children,
  ...heading
}: SectionHeadingProps & { defaultOpen?: boolean; children: ReactNode }) {
  return (
    <Collapsible defaultOpen={defaultOpen} render={<section />} className="grid gap-3">
      <SectionHeading {...heading} collapsible />
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
