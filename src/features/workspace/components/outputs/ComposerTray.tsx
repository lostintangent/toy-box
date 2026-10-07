// The composer tray docks to the input. Its first row holds what the owner produced: artifacts
// newest first, a checklist, and the owner's extra output. Once any output exists, empty artifact
// and checklist slots preserve that row's shape. Owners stack anything else, such as queued
// messages, below it, and the tray hides when nothing renders.

import { useState, type ReactNode } from "react";
import { defaultFilter } from "cmdk";
import { Files, Loader2 } from "lucide-react";
import { useEditorDisplay } from "@files/components/editor/kinds";
import { workspaceFileId, type WorkspaceFile } from "@files/model";
import { createFileServeUrl } from "@files/model/paths";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { createEditorPaneId } from "@workspace/model/panes";
import type { ChecklistItem } from "@/shared/ui/checklist";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/shared/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@/shared/ui/preview-card";
import { RelativeTime } from "@/shared/ui/relative-time";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { HTML_SANDBOX_PERMISSIONS } from "@/shared/embeddedHtml";
import { cn } from "@/shared/utils";
import {
  ArtifactPill,
  emptyOutputPillClassName,
  outputPillClassName,
  useArtifactState,
} from "./ArtifactPill";
import { ChecklistPopup } from "./ChecklistPopup";

// The newest artifact joins the row once the composer has room; two more follow when wide.
const INLINE_ARTIFACT_CLASS_NAMES = ["@max-md:hidden", "@max-2xl:hidden", "@max-2xl:hidden"];

/** A file its owner presents as output. */
type ComposerArtifact = {
  file: WorkspaceFile;
  /** Shown instead of the file's own name. */
  label?: string;
  /** When its owner last updated or shared it, in epoch milliseconds. */
  time: number;
};

export function ComposerTray({
  artifacts,
  artifactTimeLabel,
  checklist,
  checklistLabel,
  checklistHeaderDetail,
  extraOutput,
  onOpenArtifact,
  children,
}: {
  /** Newest first. */
  artifacts: readonly ComposerArtifact[];
  /** What an artifact's time means in its preview, such as "Updated" or "Shared". */
  artifactTimeLabel: string;
  checklist: readonly ChecklistItem[];
  checklistLabel: string;
  checklistHeaderDetail?: ReactNode;
  /** The owner's own output after the checklist, such as changed files or a preview. */
  extraOutput?: ReactNode;
  /** Opens an artifact that its owner doesn't publish. By default, focusing its editor pane brings
   *  a published artifact forward. */
  onOpenArtifact?: (file: WorkspaceFile) => void;
  children?: ReactNode;
}) {
  const { focusedPaneAtom } = useWorkspaceSurface();
  const hasOutputs = artifacts.length > 0 || checklist.length > 0 || Boolean(extraOutput);

  const openArtifact = ({ file }: ComposerArtifact) =>
    onOpenArtifact ? onOpenArtifact(file) : focusedPaneAtom.set(createEditorPaneId(file));

  return (
    <div className="mx-2 rounded-t-lg border border-b-0 bg-secondary-background p-1 empty:hidden">
      {hasOutputs && (
        <div className="flex items-center gap-1.5 p-0.5 not-last:mb-1 not-last:border-b not-last:pb-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {artifacts.slice(0, INLINE_ARTIFACT_CLASS_NAMES.length).map((artifact, index) => (
              <ArtifactPeek
                key={workspaceFileId(artifact.file)}
                className={INLINE_ARTIFACT_CLASS_NAMES[index]}
                artifact={artifact}
                timeLabel={artifactTimeLabel}
                onOpen={() => openArtifact(artifact)}
              />
            ))}
            {artifacts.length > 0 ? (
              <ArtifactList artifacts={artifacts} onOpen={openArtifact} />
            ) : (
              <span className={emptyOutputPillClassName}>
                <Files className="size-3.5 shrink-0" />0 artifacts
              </span>
            )}
          </div>
          <ChecklistPopup
            items={checklist}
            label={checklistLabel}
            headerDetail={checklistHeaderDetail}
          />
          {extraOutput}
        </div>
      )}
      {children}
    </div>
  );
}

/** An inline artifact that opens on click and, on desktop, previews on hover. */
function ArtifactPeek({
  className,
  artifact,
  timeLabel,
  onOpen,
}: {
  className?: string;
  artifact: ComposerArtifact;
  timeLabel: string;
  onOpen: () => void;
}) {
  const { file, label, time } = artifact;
  const preview = /\.svg$/i.test(file.path)
    ? "svg"
    : /\.html?$/i.test(file.path)
      ? "html"
      : undefined;
  // Inline pills share the tray's row, so each caps its width.
  const pill = (
    <ArtifactPill
      file={file}
      label={label}
      onClick={onOpen}
      className={cn("max-w-56", className)}
    />
  );
  if (!preview) return pill;

  const previewUrl = `${createFileServeUrl(file)}?v=${time}`;

  return (
    <PreviewCard>
      <PreviewCardTrigger delay={400} render={pill} />
      <PreviewCardContent side="top" align="start" sideOffset={8} className="hidden p-2 md:block">
        {preview === "svg" ? (
          <img
            src={previewUrl}
            alt=""
            className="aspect-video w-full rounded-md border bg-muted/40 object-contain"
          />
        ) : (
          <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-background">
            <iframe
              src={previewUrl}
              title={`Preview ${file.path}`}
              sandbox={HTML_SANDBOX_PERMISSIONS}
              loading="lazy"
              tabIndex={-1}
              width={960}
              height={540}
              className="absolute top-0 left-0 origin-top-left scale-[0.25] border-0"
            />
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {timeLabel} <RelativeTime date={new Date(time)} />
        </p>
      </PreviewCardContent>
    </PreviewCard>
  );
}

/** Every artifact, filterable: "+N" beside the inline pills, or the only pill when narrow. Its
 *  label and visibility follow the same container breakpoints as the inline pills. */
function ArtifactList({
  artifacts,
  onOpen,
}: {
  artifacts: readonly ComposerArtifact[];
  onOpen: (artifact: ComposerArtifact) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = artifacts.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="All artifacts"
        className={cn(
          outputPillClassName,
          count === 1 ? "@md:hidden" : count <= INLINE_ARTIFACT_CLASS_NAMES.length && "@2xl:hidden",
        )}
        render={<button type="button" />}
      >
        <Files className="size-3.5 shrink-0 @md:hidden" />
        <span className="@md:hidden">
          {count} {count === 1 ? "artifact" : "artifacts"}
        </span>
        <span className="@max-md:hidden @2xl:hidden">+{count - 1}</span>
        <span className="@max-2xl:hidden">+{count - INLINE_ARTIFACT_CLASS_NAMES.length}</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-0">
        <Command filter={filterByKeywords}>
          <CommandInput placeholder="Filter artifacts" />
          <CommandList>
            <CommandEmpty className="py-6 text-center text-sm text-muted-foreground italic">
              No matching artifacts
            </CommandEmpty>
            {artifacts.map((artifact) => (
              <ArtifactListItem
                key={workspaceFileId(artifact.file)}
                artifact={artifact}
                onSelect={() => {
                  setOpen(false);
                  onOpen(artifact);
                }}
              />
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Items select by their unique file ID, which embeds a session ID, so match only what they show.
function filterByKeywords(_value: string, search: string, keywords?: string[]) {
  return defaultFilter("", search, keywords);
}

function ArtifactListItem({
  artifact,
  onSelect,
}: {
  artifact: ComposerArtifact;
  onSelect: () => void;
}) {
  const { file, time } = artifact;
  const { name, Icon } = useEditorDisplay(file);
  const { open, busy } = useArtifactState(file);
  const label = artifact.label ?? name;

  return (
    <CommandItem value={workspaceFileId(file)} keywords={[label, file.path]} onSelect={onSelect}>
      {busy ? <Loader2 className="animate-spin" /> : <Icon />}
      <ScrollableFade
        className={cn("flex-1 whitespace-nowrap", open && "font-medium text-foreground")}
      >
        <span className="shrink-0">{label}</span>
      </ScrollableFade>
      <RelativeTime
        className="ms-auto shrink-0 text-xs text-muted-foreground"
        date={new Date(time)}
      />
    </CommandItem>
  );
}
