import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { HighlighterCore, ThemedToken } from "shiki/types";

let highlighterPromise: Promise<HighlighterCore> | null = null;

const SHIKI_THEMES = {
  light: "github-light",
  dark: "github-dark",
} as const;

type HighlightTheme = (typeof SHIKI_THEMES)[keyof typeof SHIKI_THEMES];
const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

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

const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  md: "markdown",
  py: "python",
  yml: "yaml",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  plaintext: "text",
  plain: "text",
};

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

export function getLangFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return EXT_TO_LANG[ext] || "text";
}

export type HighlightedLine = {
  tokens: ThemedToken[];
};

function getCurrentShikiTheme(): HighlightTheme {
  if (typeof window === "undefined") return SHIKI_THEMES.dark;
  return window.matchMedia(PREFERS_DARK_QUERY).matches ? SHIKI_THEMES.dark : SHIKI_THEMES.light;
}

export async function highlightCode(
  code: string,
  language: string,
  theme: HighlightTheme = getCurrentShikiTheme(),
): Promise<HighlightedLine[] | null> {
  try {
    const highlighter = await getHighlighter();
    const normalizedLanguage = LANGUAGE_ALIASES[language.toLowerCase()] ?? language.toLowerCase();
    const effectiveLanguage = BUNDLED_LANGS.includes(normalizedLanguage)
      ? normalizedLanguage
      : "text";
    const result = highlighter.codeToTokens(code, {
      lang: effectiveLanguage,
      theme,
    });

    return result.tokens.map((tokens) => ({ tokens }));
  } catch {
    return null;
  }
}
