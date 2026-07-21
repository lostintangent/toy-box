const CLIENT_ID_STORAGE_KEY = "toybox_client_id";
let inMemoryClientId: string | null = null;

function createClientId() {
  // Try crypto.randomUUID() (requires HTTPS), fallback for HTTP
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback UUID generator for HTTP (non-secure contexts)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Get or create a tab-scoped client ID.
 *
 * IDs are stored in sessionStorage so each browser tab gets its own PTY while
 * still reconnecting across refreshes in that tab.
 */
export function getOrCreateClientId(): string {
  const storage = getSessionStorage();
  if (storage) {
    try {
      const existing = storage.getItem(CLIENT_ID_STORAGE_KEY);
      if (existing) return existing;

      const nextClientId = createClientId();
      storage.setItem(CLIENT_ID_STORAGE_KEY, nextClientId);
      return nextClientId;
    } catch {
      // Fall through to in-memory storage when sessionStorage is unavailable.
    }
  }

  if (!inMemoryClientId) {
    inMemoryClientId = createClientId();
  }
  return inMemoryClientId;
}
