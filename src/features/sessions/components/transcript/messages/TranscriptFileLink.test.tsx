import { describe, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown, type Components, type ExtraProps } from "streamdown";
import { createEditorPaneId } from "@workspace/model/panes";
import { sessionFile } from "@files/model";
import { resolveTranscriptArtifactPath, transcriptRehypePlugins } from "./TranscriptFileLink";

type TestLinkProps = ComponentProps<"a"> & ExtraProps;

function TestLink({ node: _node, ...props }: TestLinkProps) {
  return <a {...props} />;
}

const testLinkComponents = { a: TestLink } satisfies Components;

describe("transcript artifact links", () => {
  test("recognizes a known artifact even when its editor is not mounted", () => {
    expect(
      resolveTranscriptArtifactPath(
        "nested/report.brief",
        "session",
        [],
        [{ path: "nested/report.brief", updatedAt: 1 }],
      ),
    ).toBe("nested/report.brief");
  });

  test("still recognizes an already visible artifact without a catalog", () => {
    const paneId = createEditorPaneId(sessionFile("session", "report.md"));
    expect(resolveTranscriptArtifactPath("./report.md#heading", "session", [{ id: paneId }])).toBe(
      "report.md",
    );
  });

  test("leaves unlisted relative links out of artifact navigation", () => {
    expect(
      resolveTranscriptArtifactPath(
        "missing.md",
        "session",
        [],
        [{ path: "report.md", updatedAt: 1 }],
      ),
    ).toBeUndefined();
  });

  test("preserves relative links while sanitizing unsafe URLs", () => {
    const markup = renderToStaticMarkup(
      <Streamdown
        mode="static"
        components={testLinkComponents}
        rehypePlugins={transcriptRehypePlugins}
      >
        {
          "Open [the artifact](nested/report.brief), [the docs](https://example.com), and [unsafe](javascript:alert(1))."
        }
      </Streamdown>,
    );

    expect(markup).toContain('href="nested/report.brief"');
    expect(markup).toContain('href="https://example.com"');
    expect(markup).not.toContain("[blocked]");
    expect(markup).not.toContain("javascript:");
  });
});
