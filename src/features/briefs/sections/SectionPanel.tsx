import { useId, type ReactNode } from "react";
import { ChevronRight, Info, Loader2, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Separator } from "@/shared/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/utils";
import { planSteps, projectedRecords, type BriefDocument, type BriefSection } from "../model/index";

type SectionActions = {
  regenerate?: {
    busy: boolean;
    onSelect?: () => void;
  };
  onDelete?: () => void;
};

export function SectionPanel({
  id,
  title,
  purpose,
  count,
  open,
  actions,
  children,
  onOpenChange,
}: {
  id?: string;
  title: string;
  purpose: string;
  count: number;
  open: boolean;
  actions?: SectionActions;
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
}) {
  const contentId = useId();

  return (
    <section id={id} className="relative scroll-mt-4 border-b border-border/60 last:border-b-0">
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          aria-controls={contentId}
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="flex min-w-0 cursor-pointer items-center gap-2 py-3 text-left"
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 truncate text-sm font-semibold text-foreground/90">{title}</span>
        </button>
        <PurposeTooltip title={title} purpose={purpose} />
        <span className="min-w-0 flex-1" />
        {actions && (
          <>
            <SectionActionsMenu title={title} {...actions} />
            <Separator orientation="vertical" className="h-4! bg-border/70" />
          </>
        )}
        <ItemCount count={count} />
      </div>
      <div id={contentId} hidden={!open} className="pb-5 pl-6 pr-1">
        {children}
      </div>
    </section>
  );
}

function PurposeTooltip({ title, purpose }: { title: string; purpose: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`About ${title}: ${purpose}`}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info aria-hidden className="size-3" />
          </button>
        }
      />
      <TooltipContent sideOffset={6} className="max-w-72">
        {purpose}
      </TooltipContent>
    </Tooltip>
  );
}

function ItemCount({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} ${count === 1 ? "item" : "items"}`}
      className="min-w-4 text-center text-[10px] tabular-nums text-muted-foreground"
    >
      {count}
    </span>
  );
}

function SectionActionsMenu({
  title,
  regenerate,
  onDelete,
}: {
  title: string;
} & SectionActions) {
  const busy = regenerate?.busy ?? false;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Actions for ${title}`}
            aria-busy={busy || undefined}
            title={`Actions for ${title}`}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          />
        }
      >
        {busy ? (
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
        ) : (
          <MoreHorizontal aria-hidden className="size-3.5" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {regenerate && (
          <>
            <DropdownMenuItem disabled={!regenerate.onSelect || busy} onClick={regenerate.onSelect}>
              <RefreshCw aria-hidden className="size-3.5" />
              Regenerate section
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={!onDelete || busy} onClick={onDelete} variant="destructive">
          <Trash2 aria-hidden className="size-3.5" />
          Delete section
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Count the authored or projected items summarized by one section's chrome. */
export function countSectionItems(document: BriefDocument, section: BriefSection): number {
  if (section.kind === "markdown") return 1;
  if (section.kind === "list") return section.items.length;
  if (section.kind === "records") return projectedRecords(document, section.id).length;
  if (section.kind === "plan") return planSteps(section).length;
  return section.items.length;
}
