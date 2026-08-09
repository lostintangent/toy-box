import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarPanel } from "./SidebarPanel";

test("renders one controlled collapsible panel with a vertically fading body", () => {
  const expanded = renderToStaticMarkup(
    <SidebarPanel
      title="Apps"
      count={2}
      isExpanded
      onExpandedChange={() => {}}
      action={<button type="button">Add</button>}
      emptyMessage="No apps"
    >
      <span key="first">First app</span>
      <span key="second">Second app</span>
    </SidebarPanel>,
  );
  const collapsed = renderToStaticMarkup(
    <SidebarPanel
      title="Apps"
      count={0}
      isExpanded={false}
      onExpandedChange={() => {}}
      emptyMessage="No apps"
    >
      {[]}
    </SidebarPanel>,
  );

  expect(expanded).toContain("Apps (2)");
  expect(expanded).toContain(">Add</button>");
  expect(expanded).toContain('aria-expanded="true"');
  expect(expanded).toContain('data-scrollable-fade="vertical"');
  expect(expanded.match(/<li/g)).toHaveLength(2);
  expect(collapsed).toContain('aria-expanded="false"');
  expect(collapsed).toContain('aria-hidden="true"');
  expect(collapsed).toContain(" inert=");
  expect(collapsed).toContain("<ul");
  expect(collapsed).toContain("No apps");
});
