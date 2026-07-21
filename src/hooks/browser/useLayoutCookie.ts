import { useEffect } from "react";
import {
  serializeLayoutCookie,
  type LayoutPrefKey,
  type LayoutPrefs,
} from "@/lib/workspace/config/layoutPrefs";

/**
 * Persist one layout pref to its cookie whenever it changes, so the next SSR can
 * round-trip it into the pre-hydration shell. `undefined` means "nothing to
 * persist yet" (e.g. no hyper session), so the write is skipped. Serializing
 * during render keeps the effect keyed on a stable string rather than an object
 * identity, so `{ x, y }` positions don't rewrite the cookie every render.
 */
export function useLayoutCookie<K extends LayoutPrefKey>(
  key: K,
  value: LayoutPrefs[K] | undefined,
): void {
  const cookie = value === undefined ? undefined : serializeLayoutCookie(key, value);

  useEffect(() => {
    if (cookie === undefined) return;
    document.cookie = cookie;
  }, [cookie]);
}
