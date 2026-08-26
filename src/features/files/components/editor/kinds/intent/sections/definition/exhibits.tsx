import { code } from "@streamdown/code";
import {
  Box,
  Boxes,
  Code2,
  File,
  FileCode2,
  Folder,
  Image as ImageIcon,
  ListTree,
  PanelRightOpen,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { HTML_SANDBOX_PERMISSIONS } from "@files/model";
import { cn } from "@/shared/utils";
import { injectBaseHref } from "../../../html/bridge";
import type {
  DomainTreeEntry,
  ExhibitsSection,
  FileTreeEntry,
  IntentDocument,
  IntentEntityId,
  IntentExhibit,
  TreeChange,
  TreeExhibit,
} from "../../model/index";
import { PseudocodeBlock } from "./PseudocodeBlock";
import { IntentFlowExhibit } from "./flow";
import { ChangeTag, changeTextClassName } from "../shared";

const EXHIBIT_KIND_PRESENTATION: Record<
  IntentExhibit["kind"],
  { label: string; Icon: LucideIcon; className: string }
> = {
  pseudocode: { label: "Pseudocode", Icon: Code2, className: "text-sky-400" },
  flow: { label: "Flow", Icon: Waypoints, className: "text-sky-400" },
  tree: { label: "Tree", Icon: ListTree, className: "text-cyan-400" },
  image: { label: "Image", Icon: ImageIcon, className: "text-emerald-400" },
  html: { label: "HTML", Icon: FileCode2, className: "text-amber-400" },
};

const TREE_CHANGE_LABEL: Record<TreeChange, string> = {
  new: "Added",
  modified: "Modified",
  removed: "Deleted",
};

export function IntentExhibitCard({
  document,
  exhibit,
  baseUri,
  focusedEntityId,
  onInspect,
  compact = false,
  embedded = false,
  inspectable = true,
}: {
  document: IntentDocument;
  exhibit: IntentExhibit;
  baseUri?: string;
  focusedEntityId?: IntentEntityId;
  onInspect?: (entityId: IntentEntityId) => void;
  compact?: boolean;
  embedded?: boolean;
  inspectable?: boolean;
}) {
  const focused = focusedEntityId === exhibit.id;
  const kindPresentation = EXHIBIT_KIND_PRESENTATION[exhibit.kind];
  const KindIcon = kindPresentation.Icon;

  return (
    <article
      aria-current={focused || undefined}
      data-focused={focused || undefined}
      className={cn(
        "min-w-0 border border-border/70",
        embedded ? "rounded-lg bg-background/60 p-2.5" : "rounded-xl bg-card p-3",
        focused && "border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/40",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <KindIcon className={cn("size-3.5", kindPresentation.className)} />
            <h4 className="text-[11.5px] font-semibold">{exhibit.title}</h4>
            <span className="sr-only">{exhibitKindLabel(exhibit)}</span>
            {!embedded && <ChangeTag change={exhibit.change} source={exhibit.source} />}
          </div>
          {exhibit.description && (
            <Streamdown
              mode="static"
              plugins={{ code }}
              className="mt-1.5 space-y-1 text-[10.5px] leading-relaxed text-muted-foreground [&_ol]:my-1 [&_p]:my-0 [&_pre]:my-1 [&_ul]:my-1"
            >
              {exhibit.description}
            </Streamdown>
          )}
        </div>
        {onInspect && inspectable && (
          <button
            type="button"
            aria-label={`Inspect ${exhibit.title}`}
            onClick={() => onInspect(exhibit.id)}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelRightOpen className="size-3.5" />
          </button>
        )}
      </div>

      <div className={embedded ? "mt-2.5" : "mt-3"}>
        {exhibit.kind === "pseudocode" ? (
          <PseudocodeBlock
            content={exhibit.content}
            language={exhibit.language}
            label={exhibit.title}
            compact={compact}
          />
        ) : exhibit.kind === "flow" ? (
          <IntentFlowExhibit
            document={document}
            exhibit={exhibit}
            focusedEntityId={focusedEntityId}
            onInspect={onInspect}
          />
        ) : exhibit.kind === "tree" ? (
          <TreeView exhibit={exhibit} />
        ) : exhibit.kind === "image" ? (
          <img
            src={resolveExhibitUri(exhibit.uri, baseUri)}
            alt={exhibit.altText}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className={cn(
              "w-full rounded-lg bg-muted/20 object-contain",
              compact ? "max-h-56" : "max-h-[32rem]",
            )}
          />
        ) : (
          <iframe
            src={"uri" in exhibit ? resolveExhibitUri(exhibit.uri, baseUri) : undefined}
            srcDoc={
              "content" in exhibit ? resolveExhibitContent(exhibit.content, baseUri) : undefined
            }
            title={exhibit.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox={HTML_SANDBOX_PERMISSIONS}
            className={cn(
              "w-full rounded-lg border border-border/70 bg-background",
              compact ? "h-56" : "h-96",
            )}
          />
        )}
      </div>
    </article>
  );
}

export function exhibitKindLabel(exhibit: IntentExhibit): string {
  if (exhibit.kind !== "tree") return EXHIBIT_KIND_PRESENTATION[exhibit.kind].label;
  return exhibit.type === "files" ? "File tree" : "Domain tree";
}

function TreeView({ exhibit }: { exhibit: TreeExhibit }) {
  return exhibit.type === "files" ? (
    <FileTrees roots={exhibit.roots} />
  ) : (
    <DomainTrees roots={exhibit.roots} />
  );
}

function FileTrees({ roots }: { roots: readonly FileTreeEntry[] }) {
  return (
    <ul aria-label="File trees" className="space-y-1 rounded-lg bg-muted/20 px-2.5 py-2">
      {roots.map((root) => (
        <FileTreeEntryView key={root.name} entry={root} />
      ))}
    </ul>
  );
}

function FileTreeEntryView({ entry }: { entry: FileTreeEntry }) {
  const EntryIcon = entry.kind === "folder" ? Folder : File;
  const changeClassName = entry.change ? changeTextClassName(entry.change) : undefined;
  return (
    <li>
      <div className="flex min-h-6 min-w-0 items-center gap-1.5">
        <EntryIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 text-muted-foreground", changeClassName)}
        />
        <span
          className={cn(
            "min-w-0 break-all font-mono text-[11px] text-foreground/90",
            changeClassName,
          )}
        >
          {entry.name}
        </span>
        {entry.change && (
          <ChangeTag change={entry.change} label={TREE_CHANGE_LABEL[entry.change]} />
        )}
      </div>
      {entry.kind === "folder" && entry.children.length > 0 && (
        <ul className="ml-[0.4375rem] space-y-1 border-l border-border/70 pl-[0.8125rem]">
          {entry.children.map((child) => (
            <FileTreeEntryView key={child.name} entry={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function DomainTrees({ roots }: { roots: readonly DomainTreeEntry[] }) {
  return (
    <ul aria-label="Domain trees" className="space-y-1 rounded-lg bg-muted/20 px-2.5 py-2">
      {roots.map((root) => (
        <DomainTreeEntryView key={root.name} entry={root} />
      ))}
    </ul>
  );
}

function DomainTreeEntryView({ entry }: { entry: DomainTreeEntry }) {
  const EntryIcon = entry.children ? Boxes : Box;
  const changeClassName = entry.change ? changeTextClassName(entry.change) : undefined;
  return (
    <li>
      <div className="flex min-h-6 min-w-0 items-center gap-1.5">
        <EntryIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 text-muted-foreground", changeClassName)}
        />
        <span className={cn("min-w-0 text-[11px] text-foreground/90", changeClassName)}>
          {entry.name}
        </span>
        {entry.change && (
          <ChangeTag change={entry.change} label={TREE_CHANGE_LABEL[entry.change]} />
        )}
      </div>
      {entry.children && (
        <ul className="ml-[0.4375rem] space-y-1 border-l border-border/70 pl-[0.8125rem]">
          {entry.children.map((child) => (
            <DomainTreeEntryView key={child.name} entry={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function resolveExhibitUri(uri: string, baseUri: string | undefined): string {
  return baseUri ? new URL(uri, baseUri).href : uri;
}

function resolveExhibitContent(content: string, baseUri: string | undefined): string {
  return baseUri ? injectBaseHref(content, baseUri) : content;
}

export function IntentExhibitsContent({
  document,
  section,
  baseUri,
  focusedEntityId,
  onInspect,
}: {
  document: IntentDocument;
  section: ExhibitsSection;
  baseUri?: string;
  focusedEntityId?: IntentEntityId;
  onInspect?: (entityId: IntentEntityId) => void;
}) {
  return (
    <div className="space-y-3">
      {section.items.map((exhibit) => (
        <IntentExhibitCard
          key={exhibit.id}
          document={document}
          exhibit={exhibit}
          baseUri={baseUri}
          focusedEntityId={focusedEntityId}
          onInspect={onInspect}
        />
      ))}
    </div>
  );
}
