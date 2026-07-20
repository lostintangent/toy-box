import { afterEach, describe, expect, test } from "bun:test";
import { captureViewport, sendPageToInbox } from "./inbox.js";

const originalBrowser = globalThis.browser;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.browser = originalBrowser;
  globalThis.fetch = originalFetch;
});

describe("browser Inbox dispatch", () => {
  test("sends all available page context to the configured Inbox endpoint", async () => {
    let request;
    installServerSetting("https://example.com/toy-box/");
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return Response.json({}, { status: 202 });
    };

    await sendPageToInbox({
      task: "Summarize the article.",
      page: {
        title: "Example",
        url: "https://example.org/article",
        selection: "Important passage",
        linkUrl: "https://example.org/reference",
        mediaUrl: "https://example.org/image.jpg",
      },
      viewport: "data:image/jpeg;base64,c2NyZWVuc2hvdA==",
    });

    const body = JSON.parse(request.options.body);
    expect(request.url).toBe("https://example.com/toy-box/api/inbox");
    expect(request.options).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(body.prompt).toContain("Page title: Example");
    expect(body.prompt).toContain("Selected text:\nImportant passage");
    expect(body.prompt).toContain("Linked URL: https://example.org/reference");
    expect(body.prompt).toContain("Media URL: https://example.org/image.jpg");
    expect(body.prompt).toContain("Task:\nSummarize the article.");
    expect(body.attachments).toEqual([
      {
        displayName: "viewport.jpg",
        mimeType: "image/jpeg",
        base64: "c2NyZWVuc2hvdA==",
      },
    ]);
  });

  test("falls back to the localhost server when local storage is unavailable", async () => {
    let endpoint;
    globalThis.browser = {
      storage: { local: { get: async () => Promise.reject(new Error("Storage unavailable")) } },
    };
    globalThis.fetch = async (url) => {
      endpoint = url;
      return Response.json({}, { status: 202 });
    };

    await sendPageToInbox({
      task: "Summarize the article.",
      page: { url: "https://example.org/article" },
    });

    expect(endpoint).toBe("http://localhost:3100/api/inbox");
  });

  test("identifies the configured server when a network request fails", async () => {
    installServerSetting("http://toy-box.local:4100");
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    await expect(
      sendPageToInbox({
        task: "Summarize the article.",
        page: { url: "https://example.org/article" },
      }),
    ).rejects.toThrow("Couldn’t reach Toy Box at http://toy-box.local:4100/api/inbox.");
  });

  test("reports an Inbox response error", async () => {
    installServerSetting("http://localhost:3100");
    globalThis.fetch = async () => Response.json({ error: "Inbox unavailable." }, { status: 503 });

    await expect(
      sendPageToInbox({
        task: "Summarize the article.",
        page: { url: "https://example.org/article" },
      }),
    ).rejects.toThrow("Inbox unavailable.");
  });
});

describe("browser viewport capture", () => {
  test("returns only a successfully captured JPEG data URL", async () => {
    globalThis.browser = {
      tabs: {
        captureVisibleTab: async () => "data:image/jpeg;base64,c2NyZWVuc2hvdA==",
      },
    };

    await expect(captureViewport(7)).resolves.toBe("data:image/jpeg;base64,c2NyZWVuc2hvdA==");

    globalThis.browser.tabs.captureVisibleTab = async () => {
      throw new Error("Protected page");
    };
    await expect(captureViewport(7)).resolves.toBeUndefined();
  });
});

function installServerSetting(serverUrl) {
  globalThis.browser = {
    storage: { local: { get: async () => ({ serverUrl }) } },
  };
}
