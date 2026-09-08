import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarListItem } from "./SidebarListItem";

test("renders the shared row content, active state, title fade, and menu affordance", () => {
  const markup = renderToStaticMarkup(
    <SidebarListItem
      title="Regex Playground"
      icon={<span>Icon</span>}
      time={<time>Now</time>}
      badge={<span>Badge</span>}
      menuItems={<span>Rename</span>}
      isActive
    />,
  );

  expect(markup).toContain("Regex Playground");
  expect(markup).toContain("Icon");
  expect(markup).toContain("Now");
  expect(markup).toContain("Badge");
  expect(markup).toContain('aria-current="page"');
  expect(markup).toContain('data-scrollable-fade="horizontal"');
  expect(markup).toContain('aria-label="Actions for Regex Playground"');
});

test("shows an item status in place of its menu", () => {
  const markup = renderToStaticMarkup(
    <SidebarListItem
      title="Product Lab"
      menuItems={<span>Rename</span>}
      status={{
        ariaLabel: "Product Lab has unread messages",
        tooltip: "Channel has unread messages",
        icon: <span>Unread</span>,
      }}
    />,
  );

  expect(markup).toContain('role="status"');
  expect(markup).toContain('aria-label="Product Lab has unread messages"');
  expect(markup).toContain("Unread");
  expect(markup).not.toContain('aria-label="Actions for Product Lab"');
});
