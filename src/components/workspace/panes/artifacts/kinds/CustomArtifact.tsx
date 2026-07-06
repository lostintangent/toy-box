import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ArtifactContentProps } from "./index";
import { useArtifactKind } from "./index";
import {
  CUSTOM_ARTIFACT_CHANGE_MESSAGE_TYPE,
  CUSTOM_ARTIFACT_RENDER_MESSAGE_TYPE,
  injectCustomArtifactBridge,
} from "@/lib/session/artifacts/customArtifactBridge";

/**
 * The single wrapper that renders any user-registered artifact kind — the HTML artifact
 * with the data/renderer split applied: the file is *data*, and the kind's `index.html`
 * template (its `definition`) is the renderer. The wrapper owns the lifecycle (`useArtifact`
 * loads content, watches the file, persists saves) and relays between it and the sandboxed
 * template: it posts the current content in on load and on every external change, and
 * persists whatever the template emits back through the bridge. The template only
 * implements `Toybox.onRender` / `Toybox.emitChange`.
 */
export function CustomArtifact({ pane, artifact }: ArtifactContentProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { definition } = useArtifactKind(pane.path);
  const canEdit = pane.mode !== "read" && definition?.editable === true;
  const { content, revision, save } = artifact;

  // Inject the bridge once per template. The template is stable per kind, so the iframe
  // never reloads on data change — external edits re-render by re-posting content,
  // preserving in-view state (scroll, expanded nodes, focus).
  const srcDoc = useMemo(
    () => injectCustomArtifactBridge(definition?.html ?? ""),
    [definition?.html],
  );

  const postContent = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: CUSTOM_ARTIFACT_RENDER_MESSAGE_TYPE,
        content: content ?? "",
        editable: canEdit,
      },
      "*",
    );
  }, [content, canEdit]);

  // Re-post whenever the file content changes externally (revision advances) or the edit
  // mode flips. Our own saves don't advance revision, so editing never triggers a redraw
  // that would lose the cursor; a mode change re-posts so the template can toggle affordances.
  useEffect(() => {
    postContent();
  }, [postContent, revision]);

  // Persist edits the template emits back while editing is allowed.
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
      title={pane.title}
      onLoad={postContent}
      className="h-full w-full border-0 bg-background"
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-popups allow-forms allow-modals"
    />
  );
}
