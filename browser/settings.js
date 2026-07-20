export const DEFAULT_SERVER_URL = "http://localhost:3100";

const INBOX_PATH = "/api/inbox";
const SERVER_URL_KEY = "serverUrl";
const DEFAULT_HOST_PERMISSION = getHostPermission(DEFAULT_SERVER_URL);

export async function getInboxEndpoint() {
  return (await getServerSetting()).inboxEndpoint;
}

export async function getServerSetting() {
  try {
    const stored = await browser.storage.local.get(SERVER_URL_KEY);
    return parseServerSetting(stored[SERVER_URL_KEY] ?? DEFAULT_SERVER_URL);
  } catch {
    return parseServerSetting(DEFAULT_SERVER_URL);
  }
}

export async function saveServerSetting(value) {
  const next = parseServerSetting(value);

  // Keep this request before the first asynchronous boundary. Browsers only
  // allow optional permissions to be requested from a user action.
  const granted = await browser.permissions.request({
    origins: [next.hostPermission],
  });

  if (!granted) {
    throw new Error("Allow access to this server so the extension can dispatch Inbox tasks.");
  }

  const previous = await getServerSetting();
  await browser.storage.local.set({ [SERVER_URL_KEY]: next.serverUrl });

  if (
    previous.hostPermission !== next.hostPermission &&
    previous.hostPermission !== DEFAULT_HOST_PERMISSION
  ) {
    await browser.permissions.remove({ origins: [previous.hostPermission] }).catch(() => {});
  }

  return next;
}

export function parseServerSetting(value) {
  const input = typeof value === "string" ? value.trim() : "";

  if (!URL.canParse(input)) {
    throw new Error("Enter an absolute HTTP or HTTPS server URL.");
  }

  const url = new URL(input);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The Toy Box server must use HTTP or HTTPS.");
  }

  if (url.username || url.password) {
    throw new Error("The Toy Box server URL cannot include credentials.");
  }

  if (url.search || url.hash) {
    throw new Error("The Toy Box server URL cannot include a query string or fragment.");
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith(INBOX_PATH)) {
    throw new Error(`Enter the server URL without ${INBOX_PATH}; it is appended automatically.`);
  }

  const serverUrl = `${url.origin}${path}`;
  return {
    serverUrl,
    inboxEndpoint: `${serverUrl}${INBOX_PATH}`,
    hostPermission: getHostPermission(serverUrl),
  };
}

function getHostPermission(serverUrl) {
  const url = new URL(serverUrl);

  // Firefox match patterns do not support ports. Omitting it grants only this
  // scheme and host, across whichever port hosts the configured Toy Box server.
  url.port = "";
  return `${url.origin}/*`;
}
