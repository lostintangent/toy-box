import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import type { WorkspaceFile } from "./model";
import { createEditorPane } from "./model/panes";

/** Bring a file forward in this surface, opening its editor when it isn't showing. */
export function useRevealFile(): (file: WorkspaceFile) => void {
  const { reveal } = useWorkspaceSurface();
  return (file) => reveal(createEditorPane(file));
}
