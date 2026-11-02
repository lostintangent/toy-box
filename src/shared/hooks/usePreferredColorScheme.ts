import { useMediaQuery } from "./useMediaQuery";

const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

export function usePreferredColorScheme(): "dark" | "light" {
  return useMediaQuery(PREFERS_DARK_QUERY) ? "dark" : "light";
}
