import { afterEach, expect, setSystemTime, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RelativeTime } from "./relative-time";

afterEach(() => setSystemTime());

test("renders relative time during SSR", () => {
  setSystemTime(new Date("2026-07-19T12:00:00.000Z"));

  const html = renderToStaticMarkup(<RelativeTime date="2026-07-18T12:00:00.000Z" />);

  expect(html).toBe('<time dateTime="2026-07-18T12:00:00.000Z">yesterday</time>');
});
