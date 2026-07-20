import { getInboxEndpoint } from "./settings.js";

const VIEWPORT_DATA_URL_PREFIX = "data:image/jpeg;base64,";

export async function sendPageToInbox({ task, page, viewport }) {
  const body = JSON.stringify({
    prompt: buildPrompt(task, page, Boolean(viewport)),
    attachments: viewport ? [createViewportAttachment(viewport)] : undefined,
  });
  const endpoint = await getInboxEndpoint();
  let response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (cause) {
    throw new Error(`Couldn’t reach Toy Box at ${endpoint}.`, { cause });
  }

  if (response.ok) return;

  const result = await response.json().catch(() => null);
  throw new Error(result?.error ?? `Toy Box returned ${response.status}.`);
}

export async function captureViewport(windowId) {
  try {
    const dataUrl = await browser.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 82,
    });

    return dataUrl.startsWith(VIEWPORT_DATA_URL_PREFIX) ? dataUrl : undefined;
  } catch {
    // Some pages and windows cannot be captured. The viewport is optional.
    return undefined;
  }
}

function buildPrompt(task, page, hasViewport) {
  const normalizedTask = task.trim();
  const title = page.title?.trim();
  const url = page.url?.trim();
  const selection = page.selection?.trim();
  const linkUrl = page.linkUrl?.trim();
  const mediaUrl = page.mediaUrl?.trim();

  if (!normalizedTask) throw new Error("A task is required.");
  if (!url) throw new Error("The current page URL is unavailable.");

  const parts = ["Open and inspect the following page, then complete this background task."];

  if (title) {
    parts.push(`Page title: ${title}`);
  }

  parts.push(`URL: ${url}`);

  if (selection) {
    parts.push("", "Selected text:", selection);
  }

  if (linkUrl) {
    parts.push("", `Linked URL: ${linkUrl}`);
  }

  if (mediaUrl) {
    parts.push("", `Media URL: ${mediaUrl}`);
  }

  if (hasViewport) {
    parts.push("", "The attached image shows the visible viewport at submission time.");
  }

  parts.push("", "Task:", normalizedTask);
  return parts.join("\n");
}

function createViewportAttachment(dataUrl) {
  if (!dataUrl.startsWith(VIEWPORT_DATA_URL_PREFIX)) {
    throw new Error("The viewport screenshot is invalid.");
  }

  return {
    displayName: "viewport.jpg",
    mimeType: "image/jpeg",
    base64: dataUrl.slice(VIEWPORT_DATA_URL_PREFIX.length),
  };
}
