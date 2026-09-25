import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarList } from "./SidebarList";

test("keeps one semantic list mounted across empty and populated states", () => {
  const empty = renderToStaticMarkup(<SidebarList emptyState={<p>No items</p>} />);
  const populated = renderToStaticMarkup(
    <SidebarList emptyState={<p>No items</p>}>
      <span key="first">First</span>
      <span key="second">Second</span>
    </SidebarList>,
  );

  expect(empty).toContain("<ul");
  expect(empty).toContain("<li");
  expect(empty).toContain("No items");
  expect(populated.match(/<li/g)).toHaveLength(2);
  expect(populated).not.toContain("No items");
});

test("marks the vertically fading scroll port for layout measurement", () => {
  const markup = renderToStaticMarkup(
    <SidebarList className="max-h-40" emptyState={<p>No items</p>}>
      <span key="content">Content</span>
    </SidebarList>,
  );

  expect(markup).toContain('data-scrollable-fade="vertical"');
  expect(markup).toContain("max-h-40");
});
