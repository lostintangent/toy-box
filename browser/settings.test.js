import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_SERVER_URL,
  getInboxEndpoint,
  parseServerSetting,
  saveServerSetting,
} from "./settings.js";

const originalBrowser = globalThis.browser;

afterEach(() => {
  globalThis.browser = originalBrowser;
});

describe("browser server settings", () => {
  test("normalizes a server URL and removes only trailing slashes", () => {
    expect(parseServerSetting(" HTTPS://Example.COM/toy-box/// ").serverUrl).toBe(
      "https://example.com/toy-box",
    );
  });

  test("appends the Inbox path to the default or a nested server URL", () => {
    expect(parseServerSetting(DEFAULT_SERVER_URL).inboxEndpoint).toBe(
      "http://localhost:3100/api/inbox",
    );
    expect(parseServerSetting("https://example.com/toy-box/").inboxEndpoint).toBe(
      "https://example.com/toy-box/api/inbox",
    );
  });

  test("derives a cross-browser host permission without a port or server path", () => {
    expect(parseServerSetting("http://localhost:4100/toy-box").hostPermission).toBe(
      "http://localhost/*",
    );
    expect(parseServerSetting("https://example.com:8443/toy-box").hostPermission).toBe(
      "https://example.com/*",
    );
  });

  test("resolves the complete endpoint from the local browser setting", async () => {
    installBrowser({ storedServerUrl: "https://example.com/toy-box/" });

    await expect(getInboxEndpoint()).resolves.toBe("https://example.com/toy-box/api/inbox");
  });

  test("requests the host and stores the normalized server", async () => {
    const calls = installBrowser();

    await expect(saveServerSetting("https://example.com/toy-box/")).resolves.toMatchObject({
      serverUrl: "https://example.com/toy-box",
      inboxEndpoint: "https://example.com/toy-box/api/inbox",
    });
    expect(calls.requested).toEqual({ origins: ["https://example.com/*"] });
    expect(calls.stored).toEqual({ serverUrl: "https://example.com/toy-box" });
  });

  test("releases the previous optional host after changing servers", async () => {
    const calls = installBrowser({ storedServerUrl: "https://old.example.com:4100" });

    await saveServerSetting("https://new.example.com:4100");
    expect(calls.removed).toEqual({ origins: ["https://old.example.com/*"] });
  });

  test("keeps the current setting when host access is denied", async () => {
    const calls = installBrowser({ permissionGranted: false });

    await expect(saveServerSetting("https://example.com")).rejects.toThrow(
      "Allow access to this server",
    );
    expect(calls.stored).toBeUndefined();
  });

  test("rejects endpoint URLs and non-server URL components", () => {
    expect(() => parseServerSetting("http://localhost:3100/api/inbox/")).toThrow(
      "without /api/inbox",
    );
    expect(() => parseServerSetting("http://user:secret@localhost:3100")).toThrow("credentials");
    expect(() => parseServerSetting("http://localhost:3100?profile=work")).toThrow("query string");
    expect(() => parseServerSetting("file:///tmp/toy-box")).toThrow("HTTP or HTTPS");
    expect(() => parseServerSetting("localhost:3100")).toThrow("HTTP or HTTPS");
  });
});

function installBrowser({ storedServerUrl, permissionGranted = true } = {}) {
  const calls = {};

  globalThis.browser = {
    storage: {
      local: {
        get: async () => (storedServerUrl ? { serverUrl: storedServerUrl } : {}),
        set: async (value) => {
          calls.stored = value;
        },
      },
    },
    permissions: {
      request: async (permission) => {
        calls.requested = permission;
        return permissionGranted;
      },
      remove: async (permission) => {
        calls.removed = permission;
        return true;
      },
    },
  };

  return calls;
}
