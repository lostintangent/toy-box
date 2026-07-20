// Bridge between CustomArtifact and a registered HTML viewer template. It hides
// postMessage behind the template-facing API:
//
//   Toybox.onRender((content, { editable, pendingWorkers }) => { ... })
//   Toybox.emitChange(nextContent)   // persist an in-view edit back to the file
//   Toybox.spawnWorker({ name?, prompt, metadata? }) // start an artifact-scoped worker
//
// Here the file is data rendered by a separate document; in the HTML bridge the
// file itself is the document.

import type { ArtifactWorker } from "@/types";

export const CUSTOM_ARTIFACT_RENDER_MESSAGE_TYPE = "toybox-artifact:render";
export const CUSTOM_ARTIFACT_CHANGE_MESSAGE_TYPE = "toybox-artifact:change";
export const CUSTOM_ARTIFACT_WORKER_MESSAGE_TYPE = "toybox-artifact:worker";
export const CUSTOM_ARTIFACT_WORKER_RESULT_MESSAGE_TYPE = "toybox-artifact:worker-result";

export function createCustomArtifactRenderMessage(
  content: string,
  editable: boolean,
  workers: ArtifactWorker[],
) {
  return {
    type: CUSTOM_ARTIFACT_RENDER_MESSAGE_TYPE,
    content,
    editable,
    pendingWorkers: workers.map(({ sessionId, name, metadata }) => ({
      sessionId,
      ...(name === undefined ? {} : { name }),
      ...(metadata === undefined ? {} : { metadata }),
    })),
  };
}

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
  const workerMessageType = "${CUSTOM_ARTIFACT_WORKER_MESSAGE_TYPE}";
  const workerResultMessageType = "${CUSTOM_ARTIFACT_WORKER_RESULT_MESSAGE_TYPE}";

  // The most recent payload from the host, so a template that registers its
  // render handler after the first message still gets drawn immediately.
  let latest = { content: "", editable: false, pendingWorkers: [] };
  let renderHandler = null;
  const pendingRequests = new Map();

  function runRender() {
    if (typeof renderHandler !== "function") return;
    try {
      renderHandler(latest.content, {
        editable: latest.editable,
        pendingWorkers: latest.pendingWorkers,
      });
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
    spawnWorker(options) {
      if (!options || typeof options.prompt !== "string" || options.prompt.trim() === "") {
        return Promise.reject(new TypeError("Toybox.spawnWorker requires a non-empty prompt."));
      }
      if (
        options.name !== undefined &&
        (typeof options.name !== "string" || options.name.trim() === "")
      ) {
        return Promise.reject(new TypeError("Toybox.spawnWorker name must be a non-empty string."));
      }

      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });
        window.parent.postMessage(
          {
            type: workerMessageType,
            requestId,
            ...(options.name === undefined ? {} : { name: options.name }),
            prompt: options.prompt,
            ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
          },
          "*",
        );
      });
    },
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    if (!event.data) return;

    if (event.data.type === workerResultMessageType) {
      const pending = pendingRequests.get(event.data.requestId);
      if (!pending) return;
      pendingRequests.delete(event.data.requestId);
      if (typeof event.data.error === "string") {
        pending.reject(new Error(event.data.error));
      } else {
        pending.resolve({ sessionId: event.data.sessionId });
      }
      return;
    }

    if (event.data.type !== renderMessageType) return;

    latest = {
      content: typeof event.data.content === "string" ? event.data.content : "",
      editable: event.data.editable === true,
      pendingWorkers: Array.isArray(event.data.pendingWorkers) ? event.data.pendingWorkers : [],
    };
    runRender();
  });
})();
`;

  return `<script>${source}</script>`;
}
