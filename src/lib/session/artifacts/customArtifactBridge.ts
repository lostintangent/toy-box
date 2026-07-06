// Bridge between the host `CustomArtifact` pane and a custom viewer template.
//
// A custom artifact kind is a static HTML/JS document that only knows how to draw
// file content and (optionally) signal edits. This module injects a small script
// that exposes that contract as a `window.Toybox` global and hides all the
// postMessage plumbing:
//
//   Toybox.onRender((content, { editable }) => { ...render into the DOM... })
//   Toybox.emitChange(nextContent)   // persist an in-view edit back to the file
//
// The host posts a render message on load and whenever the file changes; the
// bridge relays edits back. It is the mirror of the HTML-preview bridge — there
// the file *is* the document, here the file is *data* passed into a separate view.

export const CUSTOM_ARTIFACT_RENDER_MESSAGE_TYPE = "toybox-artifact:render";
export const CUSTOM_ARTIFACT_CHANGE_MESSAGE_TYPE = "toybox-artifact:change";

/** Inject the bridge as the first thing in the document so `window.Toybox` exists
 *  before the template's own script runs. Falls back progressively for partial docs. */
export function injectCustomArtifactBridge(html: string): string {
  const bridgeScript = createCustomArtifactBridgeScript();

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}${bridgeScript}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}${bridgeScript}`);
  }

  return `${bridgeScript}${html}`;
}

function createCustomArtifactBridgeScript(): string {
  const source = String.raw`
(() => {
  const renderMessageType = "${CUSTOM_ARTIFACT_RENDER_MESSAGE_TYPE}";
  const changeMessageType = "${CUSTOM_ARTIFACT_CHANGE_MESSAGE_TYPE}";

  // The most recent payload from the host, so a template that registers its
  // render handler after the first message still gets drawn immediately.
  let latest = { content: "", editable: false };
  let renderHandler = null;

  function runRender() {
    if (typeof renderHandler !== "function") return;
    try {
      renderHandler(latest.content, { editable: latest.editable });
    } catch (error) {
      console.error("Custom artifact render failed:", error);
    }
  }

  window.Toybox = {
    onRender(handler) {
      renderHandler = handler;
      runRender();
    },
    emitChange(content) {
      window.parent.postMessage({ type: changeMessageType, content: String(content) }, "*");
    },
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    if (!event.data || event.data.type !== renderMessageType) return;

    latest = {
      content: typeof event.data.content === "string" ? event.data.content : "",
      editable: event.data.editable === true,
    };
    runRender();
  });
})();
`;

  return `<script>${source}</script>`;
}
