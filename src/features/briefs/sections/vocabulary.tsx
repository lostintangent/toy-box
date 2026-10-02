import type { ReactNode } from "react";
import { Markdown } from "@/shared/ui/markdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/utils";
import {
  fieldValueText,
  type BriefField,
  type Change,
  type DecisionStatus,
  type OptionRelationship,
  type OptionStatus,
  type TreeChange,
} from "../model/index";

/** How brief domain values read wherever they appear: tags, labels, and field values. */

const TAG_CLASS =
  "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none";

export const CHANGE_PRESENTATION: Record<
  Change,
  { label: string; backgroundClassName: string; textClassName: string; borderClassName: string }
> = {
  existing: {
    label: "Already here",
    backgroundClassName: "bg-zinc-500/10",
    textClassName: "text-zinc-400",
    borderClassName: "border-zinc-500/30",
  },
  new: {
    label: "New",
    backgroundClassName: "bg-emerald-500/10",
    textClassName: "text-emerald-400",
    borderClassName: "border-emerald-500/40",
  },
  modified: {
    label: "Changing",
    backgroundClassName: "bg-amber-500/10",
    textClassName: "text-amber-400",
    borderClassName: "border-amber-500/40",
  },
  preserved: {
    label: "Keeping",
    backgroundClassName: "bg-sky-500/10",
    textClassName: "text-sky-400",
    borderClassName: "border-sky-500/40",
  },
  removed: {
    label: "Removing",
    backgroundClassName: "bg-rose-500/10",
    textClassName: "text-rose-400",
    borderClassName: "border-rose-500/40",
  },
  renamed: {
    label: "Renaming",
    backgroundClassName: "bg-violet-500/10",
    textClassName: "text-violet-400",
    borderClassName: "border-violet-500/40",
  },
  split: {
    label: "Splitting",
    backgroundClassName: "bg-violet-500/10",
    textClassName: "text-violet-400",
    borderClassName: "border-violet-500/40",
  },
  relocated: {
    label: "Moving",
    backgroundClassName: "bg-violet-500/10",
    textClassName: "text-violet-400",
    borderClassName: "border-violet-500/40",
  },
};

const RELATIONSHIP_LABEL: Record<OptionRelationship["kind"], string> = {
  precedes: "happens before",
  "depends-on": "needs",
  causes: "leads to",
  "realized-by": "comes to life through",
  preserves: "keeps",
};

export const DECISION_STATUS_PRESENTATION: Record<
  DecisionStatus | OptionStatus,
  { label: string; className: string }
> = {
  decided: { label: "Decided", className: "bg-emerald-500/10 text-emerald-400" },
  provisional: { label: "Trying", className: "bg-amber-500/10 text-amber-400" },
  inactive: { label: "Not picked", className: "bg-zinc-500/10 text-zinc-400" },
  open: { label: "Open", className: "bg-zinc-500/10 text-zinc-400" },
};

export const TREE_CHANGE_LABEL: Record<TreeChange, string> = {
  new: "Added",
  modified: "Modified",
  removed: "Deleted",
};

/** One authored field value: Markdown text, or the labels of its chosen options. */
export function FieldValueText({
  field,
  value,
  className = "space-y-1.5",
}: {
  field: BriefField;
  value: string | string[];
  className?: string;
}) {
  const text = fieldValueText(field, value);
  return field.kind === "text" ? <Markdown className={className}>{text}</Markdown> : text;
}

export function optionRelationshipLabel(relationship: OptionRelationship): string {
  return relationship.label ?? RELATIONSHIP_LABEL[relationship.kind];
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
      <TooltipTrigger render={tag} />
      <TooltipContent sideOffset={6} className="max-w-80 break-all font-mono text-[10px]">
        {source}
      </TooltipContent>
    </Tooltip>
  );
}
