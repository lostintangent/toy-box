import { createArtifactRouteBaseUrl } from "@/lib/session/artifacts/paths";

// An HTML artifact is a file whose content is a rendered document. `injectHtmlBridge` adds the
// script that relays edits from its sandboxed iframe back to the pane and toggles editability.
// The serve route (`/api/serve`) returns the raw bytes these documents reference (sibling
// scripts, images, nested docs); it knows nothing about how they render.

const ARTIFACT_SERVE_ROUTE_PREFIX = "/api/serve";

export const HTML_BASE_ATTRIBUTE = "data-toybox-artifact-base";
export const HTML_BRIDGE_ATTRIBUTE = "data-toybox-html-bridge";
export const HTML_CHANGE_MESSAGE_TYPE = "toybox-html:change";
export const HTML_EDITABLE_MESSAGE_TYPE = "toybox-html:set-editable";

/** Origin-qualified, directory-rooted base URI for an artifact's relative embeds, pointing at
 *  the serve route for the artifact's own directory. Trailing-slashed so `new URL(embed, base)`
 *  lands inside the artifact namespace instead of the site root. Used as the HTML pane's
 *  `<base href>` and to resolve sibling embeds in rendered Markdown. */
export function createArtifactBaseUri(sessionId: string, path: string, origin: string): string {
  return `${origin}${createArtifactRouteBaseUrl(ARTIFACT_SERVE_ROUTE_PREFIX, sessionId, path)}`;
}

/** Point a wrapped document's relative URLs at the artifact's own directory on the serve route,
 *  so sibling embeds (`./chart.js`, images) resolve there rather than against the parent — a
 *  `srcdoc` iframe has no URL of its own. Inserted first in `<head>` so it governs every
 *  following resource; this wins over any base the document declares itself. */
export function injectBaseHref(html: string, baseUri: string): string {
  const baseTag = `<base ${HTML_BASE_ATTRIBUTE} href="${baseUri}" />`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (head) => `${head}${baseTag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (htmlTag) => `${htmlTag}<head>${baseTag}</head>`);
  }

  return `<head>${baseTag}</head>${html}`;
}

/** Inject the script that connects a rendered HTML document to its artifact pane. */
export function injectHtmlBridge(html: string): string {
  const cleanHtml = stripHtmlBridge(html);
  const bridgeScript = createHtmlBridgeScript();
  if (/<\/body\s*>/i.test(cleanHtml)) {
    return cleanHtml.replace(/<\/body\s*>/i, `${bridgeScript}</body>`);
  }
  if (/<\/html\s*>/i.test(cleanHtml)) {
    return cleanHtml.replace(/<\/html\s*>/i, `${bridgeScript}</html>`);
  }

  return `${cleanHtml}${bridgeScript}`;
}

function stripHtmlBridge(html: string): string {
  return html.replace(
    new RegExp(
      String.raw`<script\b(?=[^>]*\b${HTML_BRIDGE_ATTRIBUTE}\b)[^>]*>[\s\S]*?<\/script>`,
      "gi",
    ),
    "",
  );
}

// The bridge runs inside the sandboxed iframe and serializes the document back to the pane. It
// posts to `*` because the frame is a sandboxed opaque origin; the pane authenticates messages by
// `event.source` instead.
function createHtmlBridgeScript(): string {
  const source = String.raw`
(() => {
  const bridgeAttribute = "${HTML_BRIDGE_ATTRIBUTE}";
  const baseAttribute = "${HTML_BASE_ATTRIBUTE}";
  const changeMessageType = "${HTML_CHANGE_MESSAGE_TYPE}";
  const editableMessageType = "${HTML_EDITABLE_MESSAGE_TYPE}";
  const changeDelayMs = 250;
  let changeTimer;
  let isEditable = false;
  // The serialized content the host already has — null until the document finishes loading and
  // we snapshot it. A change is posted only when serialization actually differs from this, so
  // our own setup mutations (enabling edit mode, toggling designMode/contentEditable) and no-op
  // edits never save; nothing is detected until the content and bridge are initialized.
  let savedContent = null;

  function captureBaseline() {
    savedContent = serializeDocument();
  }

  function serializeDoctype(doctype) {
    if (!doctype) return "";
    const publicId = doctype.publicId ? ' PUBLIC "' + doctype.publicId + '"' : "";
    const systemId = doctype.systemId ? ' "' + doctype.systemId + '"' : "";
    return "<!DOCTYPE " + doctype.name + publicId + systemId + ">\n";
  }

  function cleanClone(node) {
    const clone = node.cloneNode(true);
    clone
      .querySelectorAll("[" + bridgeAttribute + "],[" + baseAttribute + "]")
      .forEach((node) => node.remove());
    return clone;
  }

  function serializeDocument() {
    const clone = cleanClone(document.documentElement);
    return serializeDoctype(document.doctype) + clone.outerHTML;
  }

  function postChange() {
    const content = serializeDocument();
    if (content === savedContent) return;
    savedContent = content;
    window.parent.postMessage({ type: changeMessageType, content }, "*");
  }

  function scheduleChange() {
    if (!isEditable) return;
    if (savedContent === null) return;

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
    captureBaseline();
  } else {
    window.addEventListener("load", captureBaseline, { once: true });
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

  return `<script ${HTML_BRIDGE_ATTRIBUTE}>${source}</script>`;
}
