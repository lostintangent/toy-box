import { useEffect, useEffectEvent, useRef } from "react";
import type { ArtifactRendererProps } from "./index";
import {
  CUSTOM_ARTIFACT_CHANGE_MESSAGE_TYPE,
  CUSTOM_ARTIFACT_WORKER_MESSAGE_TYPE,
  CUSTOM_ARTIFACT_WORKER_RESULT_MESSAGE_TYPE,
  createCustomArtifactRenderMessage,
  injectCustomArtifactBridge,
} from "@/lib/session/artifacts/customArtifactBridge";
import type { ArtifactWorker, JsonValue } from "@/types";

/** Relays file content and edits between Toy Box and a registered viewer template. */
export function CustomArtifact({
  title,
  mode,
  definition,
  artifact,
  pendingWorkers,
  spawnWorker,
}: ArtifactRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canEdit = mode !== "read" && definition?.editable === true;
  const { content, revision, save } = artifact;

  const srcDoc = injectCustomArtifactBridge(definition?.html ?? "");

  // Own saves do not advance revision, preserving in-view state while editing.
  useEffect(() => {
    postRender(iframeRef.current, content, canEdit, pendingWorkers);
  }, [canEdit, content, revision, pendingWorkers]);

  const handleMessage = useEffectEvent(({ source, data }: MessageEvent) => {
    if (source !== iframeRef.current?.contentWindow || !data) return;
    if (
      canEdit &&
      data.type === CUSTOM_ARTIFACT_CHANGE_MESSAGE_TYPE &&
      typeof data.content === "string"
    ) {
      save(data.content);
      return;
    }
    if (
      data.type !== CUSTOM_ARTIFACT_WORKER_MESSAGE_TYPE ||
      typeof data.requestId !== "string" ||
      typeof data.prompt !== "string"
    ) {
      return;
    }

    void spawnWorker({
      ...(typeof data.name === "string" ? { name: data.name } : {}),
      prompt: data.prompt,
      ...(data.metadata === undefined ? {} : { metadata: data.metadata as JsonValue }),
    })
      .then(({ sessionId }) => postWorkerResult(iframeRef.current, data.requestId, sessionId))
      .catch((error) => {
        console.error("Unable to spawn artifact worker:", error);
        postWorkerResult(
          iframeRef.current,
          data.requestId,
          undefined,
          "Unable to spawn artifact worker.",
        );
      });
  });

  useEffect(() => {
    const listener = (event: MessageEvent) => handleMessage(event);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  if (!definition) return null;

  return (
    <iframe
      ref={iframeRef}
      key={definition.name}
      srcDoc={srcDoc}
      title={title}
      onLoad={(event) => postRender(event.currentTarget, content, canEdit, pendingWorkers)}
      className="h-full w-full border-0 bg-background"
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-popups allow-forms allow-modals"
    />
  );
}

function postRender(
  iframe: HTMLIFrameElement | null,
  content: string | null,
  editable: boolean,
  workers: ArtifactWorker[],
) {
  iframe?.contentWindow?.postMessage(
    createCustomArtifactRenderMessage(content ?? "", editable, workers),
    "*",
  );
}

function postWorkerResult(
  iframe: HTMLIFrameElement | null,
  requestId: string,
  sessionId?: string,
  error?: string,
) {
  iframe?.contentWindow?.postMessage(
    {
      type: CUSTOM_ARTIFACT_WORKER_RESULT_MESSAGE_TYPE,
      requestId,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(error === undefined ? {} : { error }),
    },
    "*",
  );
}
