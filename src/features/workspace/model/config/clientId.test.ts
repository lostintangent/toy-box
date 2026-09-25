import { describe, expect, onTestFinished, test } from "bun:test";
import { getOrCreateClientId } from "./clientId";

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  key(index: number) {
    if (index < 0 || index >= this.store.size) return null;
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

function installWindow(sessionStorage: Storage | null) {
  const target = globalThis as typeof globalThis & { window?: { sessionStorage: Storage } };
  const originalDescriptor = Object.getOwnPropertyDescriptor(target, "window");

  if (sessionStorage) {
    Object.defineProperty(target, "window", {
      value: { sessionStorage },
      configurable: true,
      writable: true,
    });
  } else {
    Object.defineProperty(target, "window", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }

  onTestFinished(() => {
    if (originalDescriptor) {
      Object.defineProperty(target, "window", originalDescriptor);
      return;
    }

    Object.defineProperty(target, "window", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });
}

describe("getOrCreateClientId", () => {
  describe("common scenarios", () => {
    test("reuses the same id for repeated calls in one tab session", () => {
      const storage = new MemoryStorage();
      installWindow(storage);

      const firstId = getOrCreateClientId();
      const secondId = getOrCreateClientId();

      expect(secondId).toBe(firstId);
      expect(storage.getItem("toybox_client_id")).toBe(firstId);
    });
  });

  describe("multi-tab scenarios", () => {
    test("isolates IDs across independent tab sessionStorage instances", () => {
      const tabAStorage = new MemoryStorage();
      const tabBStorage = new MemoryStorage();

      installWindow(tabAStorage);
      const tabAId = getOrCreateClientId();

      installWindow(tabBStorage);
      const tabBId = getOrCreateClientId();

      installWindow(tabAStorage);
      const tabAIdAfterSwitch = getOrCreateClientId();

      expect(tabAIdAfterSwitch).toBe(tabAId);
      expect(tabBId).not.toBe(tabAId);
    });
  });

  describe("edge cases", () => {
    test("falls back to an in-memory ID when sessionStorage is unavailable", () => {
      installWindow(null);

      const firstId = getOrCreateClientId();
      const secondId = getOrCreateClientId();

      expect(secondId).toBe(firstId);
      expect(firstId.length).toBeGreaterThan(0);
    });
  });
});
