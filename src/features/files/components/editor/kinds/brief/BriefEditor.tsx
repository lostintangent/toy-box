import { BriefEditor as BriefFileEditor } from "@briefs/BriefEditor";
import type { BriefAction } from "@briefs/actions";
import { selectWorkspaceSessionActivity, useWorkspaceSelector } from "@workspace/hooks/state";
import { ownerSessionId } from "@files/model";
import type { EditorProps } from "../index";
import { briefWorkerRequest } from "./actions";

export function BriefEditor({
  mode,
  variant,
  baseUri,
  file,
  pendingWorkers,
  spawnWorker,
}: EditorProps) {
  const owner = ownerSessionId(file.source);
  const ownerActive = useWorkspaceSelector((workspace) => {
    if (!owner) return false;
    const { running, waiting } = selectWorkspaceSessionActivity(workspace, owner);
    return running || waiting;
  });

  return (
    <BriefFileEditor
      content={file.content!}
      revision={file.revision}
      readOnly={mode === "read"}
      compact={variant === "compact"}
      baseUri={baseUri}
      pendingActions={pendingWorkers.map(({ metadata }) => metadata as BriefAction)}
      ownerActive={ownerActive}
      onContentChange={(content) => {
        file.save(content);
        void file.flush();
      }}
      onRunAction={
        spawnWorker
          ? async (request) => {
              await spawnWorker(briefWorkerRequest(request));
            }
          : undefined
      }
    />
  );
}
