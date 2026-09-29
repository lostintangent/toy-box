import { expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarPanel } from "./SidebarPanel";

test("renders one controlled collapsible panel with a vertically fading body", () => {
  const expanded = renderToStaticMarkup(
    <SidebarPanel
      title="Apps"
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
      isExpanded={false}
      onExpandedChange={() => {}}
      emptyMessage="No apps"
    >
      {[]}
    </SidebarPanel>,
  );

  expect(expanded).toContain(">Apps</span>");
  expect(expanded).toContain(">2</span>");
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

function renderPanel(
  isExpanded: boolean,
  activity: ComponentProps<typeof SidebarPanel>["activity"],
) {
  return renderToStaticMarkup(
    <SidebarPanel
      title="Automations"
      isExpanded={isExpanded}
      onExpandedChange={() => {}}
      action={<button type="button">Add</button>}
      activity={activity}
    >
      {[]}
    </SidebarPanel>,
  );
}

test("shows its items' activity in place of the action only while collapsed", () => {
  const collapsed = renderPanel(false, { running: true });
  const expanded = renderPanel(true, { running: true });

  expect(collapsed).toContain('aria-label="Automations: running"');
  expect(collapsed).not.toContain(">Add</button>");
  expect(expanded).toContain(">Add</button>");
  expect(expanded).not.toContain('role="status"');
  expect(renderPanel(false, {})).toContain(">Add</button>");
});

test("surfaces waiting, then done, then unread, then running", () => {
  expect(
    renderPanel(false, { waiting: true, finished: true, unread: true, running: true }),
  ).toContain('aria-label="Automations: waiting for input"');
  expect(renderPanel(false, { finished: true, unread: true, running: true })).toContain(
    'aria-label="Automations: done"',
  );
  expect(renderPanel(true, { finished: true })).not.toContain('role="status"');
  expect(renderPanel(false, { unread: true, running: true })).toContain(
    'aria-label="Automations: unread messages"',
  );
});
