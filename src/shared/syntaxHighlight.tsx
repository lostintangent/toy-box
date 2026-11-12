import { code, type HighlightOptions } from "@streamdown/code";
import type { HighlightToken } from "streamdown";

/** Tokenizes code per line with the transcript's cached, lazily loaded highlighter. */
export function highlightCode(source: string, language: string): Promise<HighlightToken[][]> {
  return new Promise((resolve) => {
    const options = {
      code: source,
      language: language as HighlightOptions["language"],
      themes: code.getThemes(),
    };
    const cached = code.highlight(options, (result) => resolve(result.tokens));
    if (cached) resolve(cached.tokens);
  });
}

/** Renders one line's tokens, colored for the page's light or dark scheme. */
export function HighlightedTokens({ tokens }: { tokens: HighlightToken[] }) {
  return tokens.map(({ content, htmlStyle }, index) => (
    <span
      // eslint-disable-next-line react/no-array-index-key -- tokens have no stable identity
      key={index}
      style={{
        color: htmlStyle?.color && `light-dark(${htmlStyle.color}, ${htmlStyle["--shiki-dark"]})`,
      }}
    >
      {content}
    </span>
  ));
}
