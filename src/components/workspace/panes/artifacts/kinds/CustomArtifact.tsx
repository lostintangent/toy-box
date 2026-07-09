import { useEffect, useRef } from "react";
import type { ArtifactRendererProps } from "./index";
import {
  CUSTOM_ARTIFACT_CHANGE_MESSAGE_TYPE,
  CUSTOM_ARTIFACT_RENDER_MESSAGE_TYPE,
  injectCustomArtifactBridge,
} from "@/lib/session/artifacts/customArtifactBridge";

/** Relays file content and edits between Toy Box and a registered viewer template. */
export function CustomArtifact({ title, mode, definition, artifact }: ArtifactRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canEdit = mode !== "read" && definition?.editable === true;
  const { content, revision, save } = artifact;

  const srcDoc = injectCustomArtifactBridge(definition?.html ?? "");

  // Own saves do not advance revision, preserving in-view state while editing.
  useEffect(() => {
    postContent(iframeRef.current, content, canEdit);
  }, [canEdit, content, revision]);

  useEffect(() => {
    const handleMessage = ({ source, data }: MessageEvent) => {
      if (source !== iframeRef.current?.contentWindow || !canEdit) return;
      if (data?.type === CUSTOM_ARTIFACT_CHANGE_MESSAGE_TYPE && typeof data.content === "string") {
        save(data.content);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [canEdit, save]);

  if (!definition) return null;

  return (
    <iframe
      ref={iframeRef}
      key={definition.name}
      srcDoc={srcDoc}
      title={title}
      onLoad={(event) => postContent(event.currentTarget, content, canEdit)}
      className="h-full w-full border-0 bg-background"
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-popups allow-forms allow-modals"
    />
  );
}

function postContent(iframe: HTMLIFrameElement | null, content: string | null, editable: boolean) {
  iframe?.contentWindow?.postMessage(
    {
      type: CUSTOM_ARTIFACT_RENDER_MESSAGE_TYPE,
      content: content ?? "",
      editable,
    },
    "*",
  );
}
