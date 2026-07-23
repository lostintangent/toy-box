import { useEffect, useRef } from "react";
import type { ArtifactRendererProps } from "../index";
import {
  injectBaseHref,
  injectHtmlBridge,
  HTML_CHANGE_MESSAGE_TYPE,
  HTML_EDITABLE_MESSAGE_TYPE,
} from "@/lib/session/artifacts/html";

type HtmlChangeMessage = {
  type: typeof HTML_CHANGE_MESSAGE_TYPE;
  content: string;
};

/** Sandboxed HTML document with bridged editing and relative resource serving. */
export function HtmlArtifact({ title, mode, baseUri, artifact }: ArtifactRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canEdit = mode !== "read";
  const { content, save } = artifact;

  // Own saves do not update the external baseline, preserving iframe state while editing.
  const srcDoc =
    content === null || !baseUri ? "" : injectBaseHref(injectHtmlBridge(content), baseUri);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isHtmlChangeMessage(event.data)) return;
      if (!canEdit) return;
      save(event.data.content);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [canEdit, save]);

  useEffect(() => {
    syncEditMode(iframeRef.current, canEdit);
  }, [canEdit]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      title={title}
      onLoad={(event) => syncEditMode(event.currentTarget, canEdit)}
      className="h-full w-full border-0 bg-background"
      referrerPolicy="no-referrer"
      sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts allow-top-navigation-by-user-activation"
    />
  );
}

function syncEditMode(iframe: HTMLIFrameElement | null, editable: boolean) {
  iframe?.contentWindow?.postMessage({ type: HTML_EDITABLE_MESSAGE_TYPE, editable }, "*");
}

function isHtmlChangeMessage(value: unknown): value is HtmlChangeMessage {
  if (!value || typeof value !== "object") return false;

  const message = value as Partial<HtmlChangeMessage>;
  return message.type === HTML_CHANGE_MESSAGE_TYPE && typeof message.content === "string";
}
