import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunningIndicator } from "./running-indicator";

test("stays hidden from assistive tech as decoration", () => {
  expect(renderToStaticMarkup(<RunningIndicator />)).toContain('aria-hidden="true"');
});

test("is announced when it carries a label", () => {
  const html = renderToStaticMarkup(<RunningIndicator aria-label="In progress" />);

  expect(html).toContain('aria-label="In progress"');
  expect(html).not.toContain('aria-hidden="true"');
});
