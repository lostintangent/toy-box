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
    >
      Body
    </SidebarPanel>,
  );
  const collapsed = renderToStaticMarkup(
    <SidebarPanel title="Apps" count={2} isExpanded={false} onExpandedChange={() => {}}>
      Body
    </SidebarPanel>,
  );

  expect(expanded).toContain("Apps (2)");
  expect(expanded).toContain(">Add</button>");
  expect(expanded).toContain('aria-expanded="true"');
  expect(expanded).toContain('data-scrollable-fade="vertical"');
  expect(collapsed).toContain('aria-expanded="false"');
  expect(collapsed).toContain('aria-hidden="true"');
  expect(collapsed).toContain(" inert=");
});
