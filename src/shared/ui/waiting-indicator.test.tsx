import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WaitingIndicator } from "./waiting-indicator";

test("stays hidden from assistive tech as decoration", () => {
  expect(renderToStaticMarkup(<WaitingIndicator />)).toContain('aria-hidden="true"');
});

test("is announced when it carries a label", () => {
  const html = renderToStaticMarkup(<WaitingIndicator aria-label="Waiting for input" />);

  expect(html).toContain('aria-label="Waiting for input"');
  expect(html).not.toContain('aria-hidden="true"');
});
