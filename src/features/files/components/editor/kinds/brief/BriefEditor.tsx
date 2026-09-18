import { BriefEditor as BriefFileEditor } from "@briefs/BriefEditor";
import type { BriefAction } from "@briefs/actions";
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
  return (
    <BriefFileEditor
      content={file.content!}
      revision={file.revision}
      readOnly={mode === "read"}
      compact={variant === "compact"}
      baseUri={baseUri}
      pendingActions={pendingWorkers.map(({ metadata }) => metadata as BriefAction)}
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
