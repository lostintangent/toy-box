import { useEffect, useEffectEvent, useRef } from "react";
import type { JSONType } from "zod";
import type { EditorProps } from "../index";
import {
  CUSTOM_EDITOR_CHANGE_MESSAGE_TYPE,
  CUSTOM_EDITOR_WORKER_MESSAGE_TYPE,
  CUSTOM_EDITOR_WORKER_RESULT_MESSAGE_TYPE,
  createCustomEditorRenderMessage,
  injectCustomEditorBridge,
} from "./customEditorBridge";
import type { Worker } from "@workers/model";

/** Relays file content and edits between Toy Box and a registered viewer template. */
export function CustomEditor({
  title,
  mode,
  definition,
  file,
  pendingWorkers,
  spawnWorker,
}: EditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canEdit = mode !== "read" && definition?.editable === true;
  const { content, revision, save } = file;

  const srcDoc = injectCustomEditorBridge(definition?.html ?? "");

  // Own saves do not advance revision, preserving in-view state while editing.
  useEffect(() => {
    postRender(iframeRef.current, content, revision, canEdit, pendingWorkers);
  }, [canEdit, content, revision, pendingWorkers]);

  const handleMessage = useEffectEvent(({ source, data }: MessageEvent) => {
    if (source !== iframeRef.current?.contentWindow || !data) return;
    if (
      canEdit &&
      data.type === CUSTOM_EDITOR_CHANGE_MESSAGE_TYPE &&
      typeof data.content === "string"
    ) {
      save(data.content);
      return;
    }
    if (
      data.type !== CUSTOM_EDITOR_WORKER_MESSAGE_TYPE ||
      typeof data.requestId !== "string" ||
      typeof data.prompt !== "string"
    ) {
      return;
    }

    if (!spawnWorker) {
      postWorkerResult(
        iframeRef.current,
        data.requestId,
        undefined,
        "Background workers aren't available for this file.",
      );
      return;
    }

    void spawnWorker({
      ...(typeof data.name === "string" ? { name: data.name } : {}),
      prompt: data.prompt,
      ...(data.metadata === undefined ? {} : { metadata: data.metadata as JSONType }),
    })
      .then(({ sessionId }) => postWorkerResult(iframeRef.current, data.requestId, sessionId))
      .catch((error) => {
        console.error("Unable to spawn worker:", error);
        postWorkerResult(iframeRef.current, data.requestId, undefined, "Unable to spawn worker.");
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
      onLoad={(event) =>
        postRender(event.currentTarget, content, revision, canEdit, pendingWorkers)
      }
      className="h-full w-full border-0 bg-background"
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-popups allow-forms allow-modals"
    />
  );
}

function postRender(
  iframe: HTMLIFrameElement | null,
  content: string | null,
  revision: number,
  editable: boolean,
  workers: Worker[],
) {
  iframe?.contentWindow?.postMessage(
    createCustomEditorRenderMessage(content ?? "", revision, editable, workers),
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
      type: CUSTOM_EDITOR_WORKER_RESULT_MESSAGE_TYPE,
      requestId,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(error === undefined ? {} : { error }),
    },
    "*",
  );
}
