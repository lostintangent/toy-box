import { useSyncExternalStore } from "react";
import { getSettings, subscribeSettings, type Settings } from "@/lib/config/settings";

export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSyncExternalStore(
    subscribeSettings,
    () => getSettings()[key],
    () => getSettings()[key],
  );
}
