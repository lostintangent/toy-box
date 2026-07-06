import { useMemo } from "react";
import { Documint, type EditorTheme } from "documint";
import type { ArtifactContentProps } from "./index";
import { createHtmlPreviewBaseUri } from "@/lib/session/artifacts/htmlPreview";
import {
  usePreferredColorScheme,
  type PreferredColorScheme,
} from "@/hooks/browser/usePreferredColorScheme";

const DOCUMINT_THEME_FALLBACKS = {
  light: {
    accent: "oklch(0.708 0 0)",
    background: "oklch(1 0 0)",
    externalChangeAdditionBackground: "rgba(34, 197, 94, 0.18)",
    externalChangeModificationBackground: "rgba(59, 130, 246, 0.18)",
    muted: "oklch(0.556 0 0)",
    text: "oklch(0.145 0 0)",
  },
  dark: {
    accent: "oklch(0.556 0 0)",
    background: "oklch(0.145 0 0)",
    externalChangeAdditionBackground: "rgba(34, 197, 94, 0.24)",
    externalChangeModificationBackground: "rgba(96, 165, 250, 0.24)",
    muted: "oklch(0.708 0 0)",
    text: "oklch(0.985 0 0)",
  },
} satisfies Record<PreferredColorScheme, EditorTheme>;
const DOCUMINT_FONT_SIZE = 14;

/** A rich Markdown editor. External edits surface as inline diffs (outside edit mode). */
export function MarkdownArtifact({ pane, artifact }: ArtifactContentProps) {
  const theme = useDocumintTheme();
  // Resolve relative embed URLs (e.g. `chart.html`) against this session's preview
  // endpoint, so sibling artifacts render in place.
  const baseUri = useMemo(
    () =>
      typeof window === "undefined"
        ? undefined
        : createHtmlPreviewBaseUri(pane.sourceSessionId, pane.path, window.location.origin),
    [pane.path, pane.sourceSessionId],
  );

  return (
    <Documint
      key={pane.path}
      className="h-full"
      baseUri={baseUri}
      content={artifact.content ?? ""}
      onContentChanged={artifact.save}
      readOnly={pane.mode === "read"}
      showDiffs={pane.mode !== "edit"}
      theme={theme}
    />
  );
}

function useDocumintTheme(): EditorTheme {
  const colorScheme = usePreferredColorScheme();

  return useMemo(() => createDocumintTheme(colorScheme), [colorScheme]);
}

function createDocumintTheme(colorScheme: PreferredColorScheme): EditorTheme {
  const fallback = DOCUMINT_THEME_FALLBACKS[colorScheme];

  return {
    accent: readThemeColor("--ring", fallback.accent),
    background: readThemeColor("--background", fallback.background),
    externalChangeAdditionBackground: fallback.externalChangeAdditionBackground,
    externalChangeModificationBackground: fallback.externalChangeModificationBackground,
    fontSize: DOCUMINT_FONT_SIZE,
    muted: readThemeColor("--muted-foreground", fallback.muted),
    text: readThemeColor("--foreground", fallback.text),
  };
}

function readThemeColor(variableName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;

  return (
    getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() || fallback
  );
}
