import { useMemo } from "react";
import { useSetAtom } from "jotai";
import type { LucideIcon } from "lucide-react";
import { focusedPaneAtom } from "@/atoms";
import { artifactDisplay } from "@/components/session/panes/artifacts/kinds";
import { createArtifactPaneId } from "@/hooks/session/sessionPanes";
import { cn } from "@/lib/utils";

// Pills for a session's artifacts. Clicking one focuses the artifact's pane
// (via focusedPaneAtom): the desktop grid maximizes it and the mobile pager
// pages to it, with no per-layout wiring.

export interface ArtifactsListProps {
  sourceSessionId: string;
  artifacts?: string[];
}

type ArtifactPillData = {
  key: string;
  path: string;
  name: string;
  Icon: LucideIcon;
};

export function ArtifactsList({ sourceSessionId, artifacts = [] }: ArtifactsListProps) {
  const setFocusedPaneId = useSetAtom(focusedPaneAtom);
  const artifactPills = useMemo(() => {
    const occurrences = new Map<string, number>();
    return artifacts.map((path) => {
      const occurrence = occurrences.get(path) ?? 0;
      occurrences.set(path, occurrence + 1);
      return {
        key: occurrence === 0 ? path : `${path}:${occurrence}`,
        path,
        ...artifactDisplay(path),
      };
    });
  }, [artifacts]);

  if (artifactPills.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {artifactPills.map((artifact) => (
        <ArtifactPill
          key={artifact.key}
          artifact={artifact}
          onSelect={(path) => setFocusedPaneId(createArtifactPaneId(sourceSessionId, path))}
        />
      ))}
    </div>
  );
}

function ArtifactPill({
  artifact,
  onSelect,
}: {
  artifact: ArtifactPillData;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      type="button"
      title={artifact.path}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground",
        "cursor-pointer hover:bg-muted hover:text-foreground",
      )}
      onClick={() => onSelect(artifact.path)}
    >
      <artifact.Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-48 truncate">{artifact.name}</span>
    </button>
  );
}
