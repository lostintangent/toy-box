import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentMention } from "./AgentMention";

describe("AgentMention", () => {
  test("decorates mentions in prose but not code or links", () => {
    const markup = renderToStaticMarkup(
      <AgentMention content="Ask **@critic**, not `@builder` or [@planner](https://example.com)." />,
    );

    expect(markup.match(/data-agent-mention="[^"]+"/g)).toEqual(['data-agent-mention="critic"']);
  });
});
