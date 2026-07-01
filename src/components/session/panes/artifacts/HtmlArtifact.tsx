import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ArtifactContentProps } from "./kinds";
import {
  createHtmlPreviewUrl,
  HTML_PREVIEW_CHANGE_MESSAGE_TYPE,
  HTML_PREVIEW_EDITABLE_MESSAGE_TYPE,
  stripHtmlPreviewBridge,
} from "@/lib/session/artifacts/htmlPreview";

type HtmlPreviewChangeMessage = {
  type: typeof HTML_PREVIEW_CHANGE_MESSAGE_TYPE;
  html: string;
};

/** A live, optionally editable HTML preview. Edits made in the sandboxed iframe are
 *  relayed back through the preview bridge and persisted via the artifact. */
export function HtmlArtifact({ pane, artifact }: ArtifactContentProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canEditPreview = pane.mode !== "read";
  const { revision, save } = artifact;

  // The preview reloads only when the file changes externally (revision advances),
  // never on our own saves — so in-place editing keeps its cursor and scroll.
  const previewUrl = useMemo(
    () => createHtmlPreviewUrl(pane.sourceSessionId, pane.path, revision),
    [revision, pane.path, pane.sourceSessionId],
  );

  const syncPreviewMode = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: HTML_PREVIEW_EDITABLE_MESSAGE_TYPE, editable: canEditPreview },
      "*",
    );
  }, [canEditPreview]);

  // Persist the edits the in-page bridge posts back while the preview is editable.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isHtmlPreviewChangeMessage(event.data)) return;
      if (!canEditPreview) return;
      save(stripHtmlPreviewBridge(event.data.html));
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [canEditPreview, save]);

  // Keep the iframe's edit mode in sync with the pane mode.
  useEffect(() => {
    syncPreviewMode();
  }, [syncPreviewMode]);

  return (
    <iframe
      ref={iframeRef}
      key={previewUrl}
      src={previewUrl}
      title={pane.title}
      onLoad={syncPreviewMode}
      className="h-full w-full border-0 bg-background"
      referrerPolicy="no-referrer"
      sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts allow-top-navigation-by-user-activation"
    />
  );
}

function isHtmlPreviewChangeMessage(value: unknown): value is HtmlPreviewChangeMessage {
  if (!value || typeof value !== "object") return false;

  const message = value as Partial<HtmlPreviewChangeMessage>;
  return message.type === HTML_PREVIEW_CHANGE_MESSAGE_TYPE && typeof message.html === "string";
}
