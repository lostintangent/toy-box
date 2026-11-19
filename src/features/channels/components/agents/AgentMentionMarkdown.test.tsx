import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelPaneProvider } from "../pane/ChannelPaneContext";
import { AgentMentionMarkdown } from "./AgentMentionMarkdown";

describe("AgentMentionMarkdown", () => {
  test("decorates mentions in prose but not code or links", () => {
    const markup = renderToStaticMarkup(
      <AgentMentionMarkdown content="Ask **@critic**, not `@builder` or [@planner](https://example.com)." />,
    );

    expect(markup.match(/data-agent-mention="[^"]+"/g)).toEqual(['data-agent-mention="critic"']);
  });

  test("opens file links that name an artifact and shows the others as text", () => {
    const pane = {
      openArtifactLink: (href: string) => (href === "file:plan.md" ? () => {} : undefined),
    };
    const markup = renderToStaticMarkup(
      <ChannelPaneProvider value={pane as never}>
        <AgentMentionMarkdown content="Read [the **plan**](file:plan.md), not [notes](file:notes.md)." />
      </ChannelPaneProvider>,
    );

    const link = markup.match(/<button[^>]*>(.*?)<\/button>/)?.[1];
    expect(link?.replace(/<[^>]+>/g, "")).toBe("the plan");
    expect(markup).toContain(", not notes.");
  });
});
