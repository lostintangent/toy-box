import { useId, type ReactNode } from "react";
import {
  ChevronRight,
  Info,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Separator } from "@/shared/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils";
import type { Change, DecisionStatus, OptionRelationship } from "../model/index";

const TAG_CLASS =
  "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none";

const CHANGE_PRESENTATION: Record<
  Change,
  { label: string; backgroundClassName: string; textClassName: string }
> = {
  existing: {
    label: "Already here",
    backgroundClassName: "bg-zinc-500/10",
    textClassName: "text-zinc-400",
  },
  new: {
    label: "New",
    backgroundClassName: "bg-emerald-500/10",
    textClassName: "text-emerald-400",
  },
  modified: {
    label: "Changing",
    backgroundClassName: "bg-amber-500/10",
    textClassName: "text-amber-400",
  },
  preserved: {
    label: "Keeping",
    backgroundClassName: "bg-sky-500/10",
    textClassName: "text-sky-400",
  },
  removed: {
    label: "Removing",
    backgroundClassName: "bg-rose-500/10",
    textClassName: "text-rose-400",
  },
  renamed: {
    label: "Renaming",
    backgroundClassName: "bg-violet-500/10",
    textClassName: "text-violet-400",
  },
  split: {
    label: "Splitting",
    backgroundClassName: "bg-violet-500/10",
    textClassName: "text-violet-400",
  },
  relocated: {
    label: "Moving",
    backgroundClassName: "bg-violet-500/10",
    textClassName: "text-violet-400",
  },
};

const RELATIONSHIP_LABEL: Record<OptionRelationship["kind"], string> = {
  precedes: "happens before",
  "depends-on": "needs",
  causes: "leads to",
  "realized-by": "comes to life through",
  preserves: "keeps",
};

const DECISION_STATUS_LABEL = {
  decided: "Decided",
  provisional: "Trying",
  inactive: "Not picked",
  open: "Open",
} as const;

export function optionRelationshipLabel(relationship: OptionRelationship): string {
  return relationship.label ?? RELATIONSHIP_LABEL[relationship.kind];
}

export function decisionStatusLabel(status: DecisionStatus | "inactive" | undefined): string {
  return DECISION_STATUS_LABEL[status ?? "open"];
}

export function Tag({
  children,
  className,
  title,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <span title={title} aria-label={ariaLabel} className={cn(TAG_CLASS, className)}>
      {children}
    </span>
  );
}

export function SectionViewControl<View extends string>({
  title,
  view,
  options,
  className,
  onViewChange,
}: {
  title: string;
  view: View;
  options: readonly {
    value: View;
    description: string;
    title: string;
    Icon: LucideIcon;
  }[];
  className?: string;
  onViewChange: (view: View) => void;
}) {
  return (
    <div className={cn("flex justify-end", className)}>
      <div
        role="group"
        aria-label={`${title} view`}
        className="inline-flex rounded-md border border-border/70 bg-muted/20 p-0.5"
      >
        {options.map(({ value, description, title: optionTitle, Icon }) => (
          <button
            key={value}
            type="button"
            aria-label={`Show ${title} as ${description}`}
            aria-pressed={view === value}
            title={optionTitle}
            onClick={() => onViewChange(value)}
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground",
              view === value && "bg-background text-foreground shadow-xs",
            )}
          >
            <Icon aria-hidden className="size-3" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function changeTextClassName(change: Change): string {
  return CHANGE_PRESENTATION[change].textClassName;
}

export function ChangeTag({
  change,
  source,
  label,
}: {
  change: Change;
  source?: string;
  label?: string;
}) {
  const presentation = CHANGE_PRESENTATION[change];
  const effectiveLabel = label ?? presentation.label;
  const tag = (
    <span
      tabIndex={source ? 0 : undefined}
      aria-label={source ? `${effectiveLabel}. Source: ${source}` : undefined}
      className={cn(
        TAG_CLASS,
        presentation.backgroundClassName,
        presentation.textClassName,
        source &&
          "cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {effectiveLabel}
    </span>
  );

  if (!source) return tag;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tag}</TooltipTrigger>
      <TooltipContent sideOffset={6} className="max-w-80 break-all font-mono text-[10px]">
        {source}
      </TooltipContent>
    </Tooltip>
  );
}

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

export function PurposeTooltip({ title, purpose }: { title: string; purpose: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`About ${title}: ${purpose}`}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info aria-hidden className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6} className="max-w-72">
        {purpose}
      </TooltipContent>
    </Tooltip>
  );
}

export function ItemCount({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} ${count === 1 ? "item" : "items"}`}
      className="min-w-4 text-center text-[10px] tabular-nums text-muted-foreground"
    >
      {count}
    </span>
  );
}

export function SectionActionsMenu({
  title,
  regenerate,
  onDelete,
}: {
  title: string;
} & SectionActions) {
  const busy = regenerate?.busy ?? false;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${title}`}
          aria-busy={busy || undefined}
          title={`Actions for ${title}`}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {busy ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <MoreHorizontal aria-hidden className="size-3.5" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {regenerate && (
          <>
            <DropdownMenuItem
              disabled={!regenerate.onSelect || busy}
              onSelect={regenerate.onSelect}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              Regenerate section
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          disabled={!onDelete || busy}
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 aria-hidden className="size-3.5" />
          Delete section
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SectionEmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-[11.5px] text-muted-foreground">{detail}</p>
    </div>
  );
}
