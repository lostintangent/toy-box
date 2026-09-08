import { describe, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown, type Components, type ExtraProps } from "streamdown";
import { transcriptRehypePlugins } from "./TranscriptFileLink";

type TestLinkProps = ComponentProps<"a"> & ExtraProps;

function TestLink({ node: _node, ...props }: TestLinkProps) {
  return <a {...props} />;
}

const testLinkComponents = { a: TestLink } satisfies Components;

describe("transcript artifact links", () => {
  test("preserves relative links while sanitizing unsafe URLs", () => {
    const markup = renderToStaticMarkup(
      <Streamdown
        mode="static"
        components={testLinkComponents}
        rehypePlugins={transcriptRehypePlugins}
      >
        {
          "Open [the artifact](nested/report.intent), [the docs](https://example.com), and [unsafe](javascript:alert(1))."
        }
      </Streamdown>,
    );

    expect(markup).toContain('href="nested/report.intent"');
    expect(markup).toContain('href="https://example.com"');
    expect(markup).not.toContain("[blocked]");
    expect(markup).not.toContain("javascript:");
  });
});
