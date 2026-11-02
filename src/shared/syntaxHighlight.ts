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

const BUNDLED_LANGS = {
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  markdown: () => import("@shikijs/langs/markdown"),
  css: () => import("@shikijs/langs/css"),
  html: () => import("@shikijs/langs/html"),
  python: () => import("@shikijs/langs/python"),
  rust: () => import("@shikijs/langs/rust"),
  go: () => import("@shikijs/langs/go"),
  yaml: () => import("@shikijs/langs/yaml"),
  bash: () => import("@shikijs/langs/bash"),
  sql: () => import("@shikijs/langs/sql"),
  graphql: () => import("@shikijs/langs/graphql"),
  vue: () => import("@shikijs/langs/vue"),
  svelte: () => import("@shikijs/langs/svelte"),
};

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [import("@shikijs/themes/github-light"), import("@shikijs/themes/github-dark")],
      langs: Object.values(BUNDLED_LANGS).map((load) => load()),
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
): Promise<HighlightedLine[] | null> {
  const theme = getCurrentShikiTheme();
  try {
    const highlighter = await getHighlighter();
    const normalizedLanguage = LANGUAGE_ALIASES[language.toLowerCase()] ?? language.toLowerCase();
    const effectiveLanguage = Object.hasOwn(BUNDLED_LANGS, normalizedLanguage)
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
