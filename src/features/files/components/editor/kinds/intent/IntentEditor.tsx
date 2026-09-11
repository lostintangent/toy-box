import { IntentEditor as IntentFileEditor } from "@intents/IntentEditor";
import type { IntentAction } from "@intents/actions";
import type { EditorProps } from "../index";
import { intentWorkerRequest } from "./actions";

export function IntentEditor({
  mode,
  variant,
  baseUri,
  file,
  pendingWorkers,
  spawnWorker,
}: EditorProps) {
  return (
    <IntentFileEditor
      content={file.content!}
      revision={file.revision}
      readOnly={mode === "read"}
      compact={variant === "compact"}
      baseUri={baseUri}
      pendingActions={pendingWorkers.map(({ metadata }) => metadata as IntentAction)}
      onContentChange={(content) => {
        file.save(content);
        void file.flush();
      }}
      onRunAction={
        spawnWorker
          ? async (request) => {
              await spawnWorker(intentWorkerRequest(request));
            }
          : undefined
      }
    />
  );
}
