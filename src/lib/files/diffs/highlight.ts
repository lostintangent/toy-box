import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { HighlighterCore, ThemedToken } from "shiki/types";

// Singleton highlighter instance
let highlighterPromise: Promise<HighlighterCore> | null = null;

const SHIKI_THEMES = {
  light: "github-light",
  dark: "github-dark",
} as const;

type HighlightTheme = (typeof SHIKI_THEMES)[keyof typeof SHIKI_THEMES];
const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

// Language mapping from file extensions
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  py: "python",
  rs: "rust",
  go: "go",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  graphql: "graphql",
  vue: "vue",
  svelte: "svelte",
};

// Languages to bundle for diff rendering.
const BUNDLED_LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "markdown",
  "css",
  "html",
  "python",
  "rust",
  "go",
  "yaml",
  "bash",
  "sql",
  "graphql",
  "vue",
  "svelte",
];

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [import("@shikijs/themes/github-light"), import("@shikijs/themes/github-dark")],
      langs: [
        import("@shikijs/langs/typescript"),
        import("@shikijs/langs/tsx"),
        import("@shikijs/langs/javascript"),
        import("@shikijs/langs/jsx"),
        import("@shikijs/langs/json"),
        import("@shikijs/langs/markdown"),
        import("@shikijs/langs/css"),
        import("@shikijs/langs/html"),
        import("@shikijs/langs/python"),
        import("@shikijs/langs/rust"),
        import("@shikijs/langs/go"),
        import("@shikijs/langs/yaml"),
        import("@shikijs/langs/bash"),
        import("@shikijs/langs/sql"),
        import("@shikijs/langs/graphql"),
        import("@shikijs/langs/vue"),
        import("@shikijs/langs/svelte"),
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

/** Get language from file path */
export function getLangFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return EXT_TO_LANG[ext] || "text";
}

export interface HighlightedLine {
  tokens: ThemedToken[];
}

function getCurrentShikiTheme(): HighlightTheme {
  if (typeof window === "undefined") return SHIKI_THEMES.dark;
  return window.matchMedia(PREFERS_DARK_QUERY).matches ? SHIKI_THEMES.dark : SHIKI_THEMES.light;
}

/**
 * Highlight code and return tokens per line.
 * Returns null if highlighting fails or language not supported.
 */
export async function highlightCode(
  code: string,
  lang: string,
  theme: HighlightTheme = getCurrentShikiTheme(),
): Promise<HighlightedLine[] | null> {
  try {
    const highlighter = await getHighlighter();

    // Fall back to text if language not loaded
    const effectiveLang = BUNDLED_LANGS.includes(lang) ? lang : "text";

    const result = highlighter.codeToTokens(code, {
      lang: effectiveLang,
      theme,
    });

    return result.tokens.map((lineTokens) => ({
      tokens: lineTokens,
    }));
  } catch {
    return null;
  }
}
