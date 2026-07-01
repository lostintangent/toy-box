import {
  createSessionArtifactRouteBaseUrl,
  createSessionArtifactRouteUrl,
} from "@/lib/session/artifacts/paths";

const HTML_PREVIEW_ROUTE_PREFIX = "/api/preview";
export const HTML_PREVIEW_BRIDGE_ATTRIBUTE = "data-toybox-html-preview-bridge";
export const HTML_PREVIEW_CHANGE_MESSAGE_TYPE = "toybox-html-preview:change";
export const HTML_PREVIEW_EDITABLE_MESSAGE_TYPE = "toybox-html-preview:set-editable";

export function createHtmlPreviewUrl(
  sessionId: string,
  path: string,
  version: number | string,
): string {
  const params = new URLSearchParams({
    v: String(version),
  });

  return `${createSessionArtifactRouteUrl(HTML_PREVIEW_ROUTE_PREFIX, sessionId, path)}?${params}`;
}

/** Base URI for resolving an artifact's relative embed URLs (e.g. `chart.html`)
 *  against the preview endpoint for the artifact's own directory. Origin-qualified
 *  and trailing-slashed so `new URL(embed, base)` lands inside the preview
 *  namespace instead of the site root. */
export function createHtmlPreviewBaseUri(sessionId: string, path: string, origin: string): string {
  return `${origin}${createSessionArtifactRouteBaseUrl(HTML_PREVIEW_ROUTE_PREFIX, sessionId, path)}`;
}

export function isHtmlPreviewPath(path: string): boolean {
  return /\.(?:html|htm)$/i.test(path);
}

export function injectHtmlPreviewBridge(html: string): string {
  const cleanHtml = stripHtmlPreviewBridge(html);
  const bridgeScript = createHtmlPreviewBridgeScript();
  if (/<\/body\s*>/i.test(cleanHtml)) {
    return cleanHtml.replace(/<\/body\s*>/i, `${bridgeScript}</body>`);
  }
  if (/<\/html\s*>/i.test(cleanHtml)) {
    return cleanHtml.replace(/<\/html\s*>/i, `${bridgeScript}</html>`);
  }

  return `${cleanHtml}${bridgeScript}`;
}

export function stripHtmlPreviewBridge(html: string): string {
  return html.replace(
    new RegExp(
      String.raw`<script\b(?=[^>]*\b${HTML_PREVIEW_BRIDGE_ATTRIBUTE}\b)[^>]*>[\s\S]*?<\/script>`,
      "gi",
    ),
    "",
  );
}

function createHtmlPreviewBridgeScript(): string {
  const source = String.raw`
(() => {
  const bridgeAttribute = "${HTML_PREVIEW_BRIDGE_ATTRIBUTE}";
  const changeMessageType = "${HTML_PREVIEW_CHANGE_MESSAGE_TYPE}";
  const editableMessageType = "${HTML_PREVIEW_EDITABLE_MESSAGE_TYPE}";
  const changeDelayMs = 250;
  let changeTimer;
  let isEditable = false;
  let isReadyForUserChanges = false;

  function markReadyForUserChanges() {
    window.setTimeout(() => {
      isReadyForUserChanges = true;
    }, 0);
  }

  function serializeDoctype(doctype) {
    if (!doctype) return "";
    const publicId = doctype.publicId ? ' PUBLIC "' + doctype.publicId + '"' : "";
    const systemId = doctype.systemId ? ' "' + doctype.systemId + '"' : "";
    return "<!DOCTYPE " + doctype.name + publicId + systemId + ">\n";
  }

  function serializeDocument() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("[" + bridgeAttribute + "]").forEach((node) => node.remove());
    return serializeDoctype(document.doctype) + clone.outerHTML;
  }

  function postChange() {
    window.parent.postMessage(
      {
        type: changeMessageType,
        html: serializeDocument(),
      },
      window.location.origin,
    );
  }

  function scheduleChange() {
    if (!isEditable) return;
    if (!isReadyForUserChanges) return;

    window.clearTimeout(changeTimer);
    changeTimer = window.setTimeout(postChange, changeDelayMs);
  }

  function setEditable(editable) {
    isEditable = editable;
    document.designMode = editable ? "on" : "off";
    if (!editable) {
      window.clearTimeout(changeTimer);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    if (!event.data || event.data.type !== editableMessageType) return;

    setEditable(event.data.editable === true);
  });

  if (document.readyState === "complete") {
    markReadyForUserChanges();
  } else {
    window.addEventListener("load", markReadyForUserChanges, { once: true });
  }

  setEditable(false);
  document.addEventListener("input", scheduleChange, true);
  document.addEventListener("cut", () => window.setTimeout(scheduleChange, 0), true);
  document.addEventListener("drop", () => window.setTimeout(scheduleChange, 0), true);
  document.addEventListener("paste", () => window.setTimeout(scheduleChange, 0), true);

  new MutationObserver(scheduleChange).observe(document.documentElement, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
})();
`;

  return `<script ${HTML_PREVIEW_BRIDGE_ATTRIBUTE}>${source}</script>`;
}
