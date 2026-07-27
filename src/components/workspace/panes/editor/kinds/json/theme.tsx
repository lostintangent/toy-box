import { createContext, useContext, type ReactNode } from "react";
import { usePreferredColorScheme } from "@/hooks/browser/usePreferredColorScheme";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import type { ScalarType } from "./document";

// The editor's presentation values. Structural colors come from theme tokens in
// markup (`text-foreground`, `text-muted-foreground`), which already follow the
// system color scheme. This layer supplies the two things tokens cannot: a
// per-type syntax palette chosen for the active scheme, and the user's own accent
// color — reused wherever the editor signals intent (active edits, drop targets).

export type JsonTheme = {
  readonly accent: string;
  readonly values: Record<ScalarType, string>;
  readonly diff: { readonly added: string; readonly changed: string };
};

const VALUE_PALETTE: Record<"light" | "dark", Record<ScalarType, string>> = {
  light: { string: "#15803d", number: "#1d4ed8", boolean: "#7c3aed", null: "#6b7280" },
  dark: { string: "#4ade80", number: "#60a5fa", boolean: "#c084fc", null: "#9ca3af" },
};

// The same external-change hues the Markdown editor uses, so an agent's edits read
// consistently across editor kinds: green for an addition, blue for a change.
const DIFF_PALETTE: Record<"light" | "dark", JsonTheme["diff"]> = {
  light: { added: "rgba(34, 197, 94, 0.18)", changed: "rgba(59, 130, 246, 0.18)" },
  dark: { added: "rgba(34, 197, 94, 0.24)", changed: "rgba(96, 165, 250, 0.24)" },
};

const JsonThemeContext = createContext<JsonTheme | null>(null);

export function JsonThemeProvider({ children }: { children: ReactNode }) {
  const scheme = usePreferredColorScheme();
  const accent = useWorkspaceSelector((workspace) => workspace.settings.accentColor);
  const theme: JsonTheme = { accent, values: VALUE_PALETTE[scheme], diff: DIFF_PALETTE[scheme] };
  return <JsonThemeContext.Provider value={theme}>{children}</JsonThemeContext.Provider>;
}

export function useJsonTheme(): JsonTheme {
  const theme = useContext(JsonThemeContext);
  if (!theme) throw new Error("useJsonTheme must be used within a JsonThemeProvider");
  return theme;
}
