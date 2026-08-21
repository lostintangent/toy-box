import { useState } from "react";
import { GitCompareArrows } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils";
import type { IntentEntityId } from "./model/index";
import type { IntentVersionChange, IntentVersionComparison } from "./model/checkpoints";

const CHANGE_GROUPS = [
  { status: "added", label: "Added" },
  { status: "changed", label: "Changed" },
  { status: "removed", label: "Removed" },
] as const;

const ITEM_LABEL: Record<IntentVersionChange["kind"], string> = {
  intent: "Document",
  section: "Section",
  record: "Item",
  work: "Work",
  exhibit: "Exact detail",
  question: "Question",
  decision: "Choice",
  relationship: "Connection",
};

export function IntentVersionControl({
  comparison,
  focusedEntityId,
  onInspect,
  onSaveVersion,
}: {
  comparison?: IntentVersionComparison;
  focusedEntityId?: IntentEntityId;
  onInspect: (entityId: IntentEntityId) => void;
  onSaveVersion?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!comparison) {
    if (!onSaveVersion) return null;
    return <VersionButton label="Save checkpoint" onClick={onSaveVersion} />;
  }

  const count = comparison.changes.length;
  const label =
    count > 0
      ? `Review ${count} change${count === 1 ? "" : "s"} since checkpoint`
      : "Checkpoint is current";
  return (
    <>
      <VersionButton label={label} onClick={() => setOpen(true)} />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-[94%] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-border pr-12">
            <SheetTitle>Changes since checkpoint</SheetTitle>
            <SheetDescription>Saved {savedAtLabel(comparison.savedAt)}.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <IntentChangesPanel
              comparison={comparison}
              focusedEntityId={focusedEntityId}
              onInspect={(entityId) => {
                setOpen(false);
                onInspect(entityId);
              }}
              onSaveVersion={onSaveVersion}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function VersionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <GitCompareArrows aria-hidden className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

export function IntentChangesPanel({
  comparison,
  focusedEntityId,
  onInspect,
  onSaveVersion,
}: {
  comparison: IntentVersionComparison;
  focusedEntityId?: IntentEntityId;
  onInspect: (entityId: IntentEntityId) => void;
  onSaveVersion?: () => void;
}) {
  return (
    <div className="space-y-3">
      {onSaveVersion && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={comparison.changes.length === 0}
            onClick={onSaveVersion}
            className="rounded-md border border-border px-3 py-1.5 text-[10.5px] font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            {comparison.changes.length === 0 ? "Checkpoint is current" : "Update checkpoint"}
          </button>
        </div>
      )}
      <p className="px-1 text-[10.5px] text-muted-foreground">
        Saved {savedAtLabel(comparison.savedAt)}. {comparison.changes.length} item
        {comparison.changes.length === 1 ? "" : "s"} changed.
      </p>

      {comparison.changes.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5 text-center">
          <p className="text-xs font-medium text-emerald-300">Nothing has changed.</p>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            The intent still matches the saved version.
          </p>
        </div>
      ) : (
        CHANGE_GROUPS.map(({ status, label }) => {
          const changes = comparison.changes.filter((change) => change.status === status);
          if (changes.length === 0) return null;
          return (
            <section key={status} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold">{label}</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[9.5px] tabular-nums text-muted-foreground">
                  {changes.length}
                </span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {changes.map((change) => (
                  <VersionChangeCard
                    key={change.key}
                    change={change}
                    focusedEntityId={focusedEntityId}
                    onInspect={onInspect}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function VersionChangeCard({
  change,
  focusedEntityId,
  onInspect,
}: {
  change: IntentVersionChange;
  focusedEntityId?: IntentEntityId;
  onInspect: (entityId: IntentEntityId) => void;
}) {
  const focused = change.entityId === focusedEntityId;
  const className = cn(
    "rounded-lg border border-border/60 bg-muted/15 p-2.5 text-left",
    change.entityId && "hover:border-muted-foreground/50",
    focused && "border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/40",
  );
  const content = (
    <>
      <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
        {ITEM_LABEL[change.kind]}
      </span>
      <span className="mt-1 block text-[11.5px] font-semibold">{change.label}</span>
      {change.previousLabel && (
        <span className="mt-1 block text-[9.5px] text-muted-foreground">
          Previously {change.previousLabel}
        </span>
      )}
    </>
  );
  const entityId = change.entityId;

  return entityId ? (
    <button
      type="button"
      onClick={() => onInspect(entityId)}
      aria-current={focused || undefined}
      data-focused={focused || undefined}
      className={className}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function savedAtLabel(value: string): string {
  return `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;
}
