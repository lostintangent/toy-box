import { useEffect, useState } from "react";

const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

export type PreferredColorScheme = "dark" | "light";

export function getPreferredColorScheme(): PreferredColorScheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(PREFERS_DARK_QUERY).matches ? "dark" : "light";
}

export function usePreferredColorScheme(): PreferredColorScheme {
  const [colorScheme, setColorScheme] = useState(getPreferredColorScheme);

  useEffect(() => {
    const media = window.matchMedia(PREFERS_DARK_QUERY);
    const handleChange = () => setColorScheme(media.matches ? "dark" : "light");

    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  return colorScheme;
}
