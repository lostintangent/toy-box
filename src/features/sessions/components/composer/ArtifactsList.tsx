import { useFocusedPaneAtom } from "@workspace/hooks/layout/surface";
import { useEditorDisplay } from "@files/components/editor/kinds";
import { createEditorPaneId } from "@workspace/model/panes";
import { sessionFile, type SessionFile } from "@files/model";
import { cn } from "@/shared/utils";

// Pills for a session's artifacts. Clicking one focuses the artifact's pane
// (via the surface's focus atom): the desktop grid maximizes it and the pager
// pages to it, with no per-layout wiring.

export function ArtifactsList({
  sourceSessionId,
  artifacts,
}: {
  sourceSessionId: string;
  artifacts: string[];
}) {
  const focusedPaneAtom = useFocusedPaneAtom();
  const occurrences = new Map<string, number>();
  const pills = artifacts.map((path) => {
    const occurrence = occurrences.get(path) ?? 0;
    occurrences.set(path, occurrence + 1);
    return {
      key: occurrence === 0 ? path : `${path}:${occurrence}`,
      file: sessionFile(sourceSessionId, path),
    };
  });

  if (pills.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {pills.map(({ key, file }) => (
        <ArtifactPill
          key={key}
          file={file}
          onSelect={() => focusedPaneAtom.set(createEditorPaneId(file))}
        />
      ))}
    </div>
  );
}

function ArtifactPill({ file, onSelect }: { file: SessionFile; onSelect: () => void }) {
  const { name, Icon } = useEditorDisplay(file);
  return (
    <button
      type="button"
      title={file.path}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground",
        "cursor-pointer hover:bg-muted hover:text-foreground",
      )}
      onClick={onSelect}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-48 truncate">{name}</span>
    </button>
  );
}
