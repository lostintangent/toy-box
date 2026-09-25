// Session outputs share one stable tray row: artifacts newest first, todos, and changed files.
// Once any output exists, empty artifact and todo slots preserve that row's shape.

import { useState } from "react";
import { Files, Loader2 } from "lucide-react";
import { useEditorDisplay } from "@files/components/editor/kinds";
import { sessionFile, type SessionFile } from "@files/model";
import { createFileServeUrl } from "@files/model/paths";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { createEditorPaneId } from "@workspace/model/panes";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/shared/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@/shared/ui/preview-card";
import { RelativeTime } from "@/shared/ui/relative-time";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { HTML_SANDBOX_PERMISSIONS } from "@/shared/embeddedHtml";
import { cn } from "@/shared/utils";
import type { SessionArtifact, TodoItem } from "../../model";
import type { DiffStats } from "../../model/fileDiffs";
import type { FileDiffSummary } from "../transcript/editDiffs";
import { ArtifactPill, emptyOutputPillClassName, outputPillClassName } from "./ArtifactPill";
import { DiffPopup } from "./DiffPopup";
import { TodoPopup } from "./TodoPopup";

// The newest artifact joins the row once the composer has room; two more follow when wide.
const INLINE_ARTIFACT_CLASS_NAMES = ["@max-md:hidden", "@max-2xl:hidden", "@max-2xl:hidden"];

type ArtifactOutput = SessionArtifact & { file: SessionFile; open: boolean; busy: boolean };

export function SessionOutputs({
  sessionId,
  artifacts,
  todos = [],
  isStreaming,
  sessionDiff,
}: {
  sessionId: string;
  artifacts: SessionArtifact[];
  todos?: TodoItem[];
  isStreaming: boolean;
  sessionDiff?: { total: DiffStats; byFile: FileDiffSummary[] };
}) {
  const { panes, focusedPaneAtom } = useWorkspaceSurface();
  const busyPaths = useWorkspaceSelector((workspace) =>
    workspace.workers.flatMap((worker) =>
      worker.type === "file" && worker.file.sessionId === sessionId ? [worker.file.path] : [],
    ),
  );
  const outputs: ArtifactOutput[] = [...artifacts]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((artifact) => {
      const file = sessionFile(sessionId, artifact.path);
      const paneId = createEditorPaneId(file);
      return {
        ...artifact,
        file,
        open: panes.some((pane) => pane.id === paneId),
        busy: busyPaths.includes(artifact.path),
      };
    });

  const hasDiff = sessionDiff && (sessionDiff.total.added > 0 || sessionDiff.total.removed > 0);
  if (outputs.length === 0 && todos.length === 0 && !hasDiff) return null;

  const openArtifact = (file: SessionFile) => focusedPaneAtom.set(createEditorPaneId(file));

  return (
    <div className="flex items-center gap-1.5 p-0.5 not-last:mb-1 not-last:border-b not-last:pb-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {outputs.slice(0, INLINE_ARTIFACT_CLASS_NAMES.length).map((output, index) => (
          <ArtifactPeek
            key={output.path}
            className={INLINE_ARTIFACT_CLASS_NAMES[index]}
            output={output}
            onOpen={() => openArtifact(output.file)}
          />
        ))}
        {outputs.length > 0 ? (
          <ArtifactList outputs={outputs} onOpen={openArtifact} />
        ) : (
          <span className={emptyOutputPillClassName}>
            <Files className="size-3.5 shrink-0" />0 artifacts
          </span>
        )}
      </div>
      <TodoPopup todos={todos} isStreaming={isStreaming} />
      {hasDiff && <DiffPopup total={sessionDiff.total} byFile={sessionDiff.byFile} />}
    </div>
  );
}

/** An inline artifact that opens on click and, on desktop, previews on hover. */
function ArtifactPeek({
  className,
  output,
  onOpen,
}: {
  className?: string;
  output: ArtifactOutput;
  onOpen: () => void;
}) {
  const preview = /\.svg$/i.test(output.path)
    ? "svg"
    : /\.html?$/i.test(output.path)
      ? "html"
      : undefined;
  const pill = (
    <ArtifactPill
      file={output.file}
      busy={output.busy}
      open={output.open}
      onClick={onOpen}
      className={className}
    />
  );
  if (!preview) return pill;

  const previewUrl = `${createFileServeUrl(output.file)}?v=${output.updatedAt}`;

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
              title={`Preview ${output.path}`}
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
          Updated <RelativeTime date={new Date(output.updatedAt)} />
        </p>
      </PreviewCardContent>
    </PreviewCard>
  );
}

/** Every artifact, filterable: "+N" beside the inline pills, or the only pill when narrow. Its
 *  label and visibility follow the same container breakpoints as the inline pills. */
function ArtifactList({
  outputs,
  onOpen,
}: {
  outputs: ArtifactOutput[];
  onOpen: (file: SessionFile) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = outputs.length;

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
        <Command>
          <CommandInput placeholder="Filter artifacts" />
          <CommandList>
            <CommandEmpty className="py-6 text-center text-sm text-muted-foreground italic">
              No matching artifacts
            </CommandEmpty>
            {outputs.map((output) => (
              <ArtifactListItem
                key={output.path}
                output={output}
                onSelect={() => {
                  setOpen(false);
                  onOpen(output.file);
                }}
              />
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ArtifactListItem({ output, onSelect }: { output: ArtifactOutput; onSelect: () => void }) {
  const { name, Icon } = useEditorDisplay(output.file);

  return (
    <CommandItem value={output.path} onSelect={onSelect}>
      {output.busy ? <Loader2 className="animate-spin" /> : <Icon />}
      <ScrollableFade
        className={cn("flex-1 whitespace-nowrap", output.open && "font-medium text-foreground")}
      >
        <span className="shrink-0">{name}</span>
      </ScrollableFade>
      <RelativeTime
        className="ms-auto shrink-0 text-xs text-muted-foreground"
        date={new Date(output.updatedAt)}
      />
    </CommandItem>
  );
}
