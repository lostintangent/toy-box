import { generateUUID } from "@/shared/utils";

const CLIENT_ID_STORAGE_KEY = "toybox_client_id";
let inMemoryClientId: string | null = null;

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

      const nextClientId = generateUUID();
      storage.setItem(CLIENT_ID_STORAGE_KEY, nextClientId);
      return nextClientId;
    } catch {
      // Fall through to in-memory storage when sessionStorage is unavailable.
    }
  }

  if (!inMemoryClientId) {
    inMemoryClientId = generateUUID();
  }
  return inMemoryClientId;
}
