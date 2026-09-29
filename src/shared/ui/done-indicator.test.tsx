import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DoneIndicator } from "./done-indicator";

test("stays hidden from assistive tech as decoration", () => {
  expect(renderToStaticMarkup(<DoneIndicator />)).toContain('aria-hidden="true"');
});

test("is announced when it carries a label", () => {
  const html = renderToStaticMarkup(<DoneIndicator aria-label="Done" />);

  expect(html).toContain('aria-label="Done"');
  expect(html).not.toContain('aria-hidden="true"');
});
