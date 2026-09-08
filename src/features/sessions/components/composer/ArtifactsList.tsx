import { useFocusedPaneAtom } from "@workspace/hooks/layout/surface";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { ArtifactPill } from "@files/components/ArtifactPill";
import { createEditorPaneId } from "@workspace/model/panes";
import { sessionFile } from "@files/model";

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
  const activeArtifactPaths = useWorkspaceSelector((workspace) =>
    artifacts.filter((path) =>
      workspace.workers.some(
        (worker) =>
          worker.type === "file" &&
          worker.file.sessionId === sourceSessionId &&
          worker.file.path === path,
      ),
    ),
  );
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
    <div className="mb-3 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
      {pills.map(({ key, file }) => (
        <ArtifactPill
          key={key}
          file={file}
          busy={activeArtifactPaths.includes(file.path)}
          onSelect={() => focusedPaneAtom.set(createEditorPaneId(file))}
        />
      ))}
    </div>
  );
}
