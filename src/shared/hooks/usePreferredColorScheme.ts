import { useMediaQuery } from "./useMediaQuery";

const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

export type PreferredColorScheme = "dark" | "light";

export function usePreferredColorScheme(): PreferredColorScheme {
  return useMediaQuery(PREFERS_DARK_QUERY) ? "dark" : "light";
}
