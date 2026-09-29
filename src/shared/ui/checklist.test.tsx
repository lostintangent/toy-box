import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Checklist, type ChecklistItem } from "./checklist";

const render = (items: ChecklistItem[]) => renderToStaticMarkup(<Checklist items={items} />);

test("labels every status for assistive tech", () => {
  const html = render([
    { id: "a", title: "Plan", status: "pending" },
    { id: "b", title: "Build", status: "in_progress" },
    { id: "c", title: "Ship", status: "blocked" },
    { id: "d", title: "Scope", status: "done" },
  ]);

  for (const label of ["Pending", "In progress", "Blocked", "Done"]) {
    expect(html).toContain(`aria-label="${label}"`);
  }
});

test("starts done parents collapsed and unfinished parents expanded", () => {
  const html = render([
    {
      id: "done",
      title: "Research",
      status: "done",
      children: [{ id: "hidden", title: "Read the docs", status: "done" }],
    },
    {
      id: "open",
      title: "Build",
      status: "in_progress",
      children: [{ id: "shown", title: "Write the parser", status: "pending" }],
    },
  ]);

  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).not.toContain("Read the docs");
  expect(html).toContain("Write the parser");
});
