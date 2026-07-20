import { useFocusedPaneAtom } from "@/hooks/workspace/layout/focus";
import { useArtifactDisplay } from "@/components/workspace/panes/artifacts/kinds";
import { createArtifactPaneId } from "@/lib/workspace/panes";
import { cn } from "@/lib/utils";

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
    return { key: occurrence === 0 ? path : `${path}:${occurrence}`, path };
  });

  if (pills.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {pills.map(({ key, path }) => (
        <ArtifactPill
          key={key}
          path={path}
          onSelect={() => focusedPaneAtom.set(createArtifactPaneId(sourceSessionId, path))}
        />
      ))}
    </div>
  );
}

function ArtifactPill({ path, onSelect }: { path: string; onSelect: () => void }) {
  const { name, Icon } = useArtifactDisplay(path);
  return (
    <button
      type="button"
      title={path}
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
