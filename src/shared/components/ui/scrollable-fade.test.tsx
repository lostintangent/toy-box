import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ScrollableFade, getScrollableFadeEdges } from "./scrollable-fade";

function measurements(overrides: Partial<HTMLElement> = {}) {
  return {
    clientHeight: 100,
    clientWidth: 100,
    scrollHeight: 100,
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 100,
    ...overrides,
  } as HTMLElement;
}

describe("ScrollableFade", () => {
  test("renders a horizontal scrolling div by default", () => {
    expect(
      renderToStaticMarkup(<ScrollableFade className="whitespace-nowrap">Content</ScrollableFade>),
    ).toBe(
      '<div data-slot="scrollable-fade" data-scrollable-fade="horizontal" class="scrollable-fade overflow-x-auto whitespace-nowrap">Content</div>',
    );
  });

  test("can apply vertical scrolling to its semantic child", () => {
    expect(
      renderToStaticMarkup(
        <ScrollableFade asChild axis="vertical" className="max-h-40">
          <section>Content</section>
        </ScrollableFade>,
      ),
    ).toBe(
      '<section data-slot="scrollable-fade" data-scrollable-fade="vertical" class="scrollable-fade overflow-y-auto max-h-40">Content</section>',
    );
  });
});

describe("getScrollableFadeEdges", () => {
  test("shows no fades when horizontal content fits", () => {
    expect(getScrollableFadeEdges(measurements())).toEqual({ start: false, end: false });
  });

  test("tracks both horizontal edges", () => {
    const element = measurements({ scrollLeft: 50, scrollWidth: 200 });
    expect(getScrollableFadeEdges(element)).toEqual({ start: true, end: true });

    element.scrollLeft = 100;
    expect(getScrollableFadeEdges(element)).toEqual({ start: true, end: false });
  });

  test("tracks both vertical edges", () => {
    const element = measurements({ scrollHeight: 200, scrollTop: 0 });
    expect(getScrollableFadeEdges(element, "vertical")).toEqual({ start: false, end: true });

    element.scrollTop = 50;
    expect(getScrollableFadeEdges(element, "vertical")).toEqual({ start: true, end: true });

    element.scrollTop = 100;
    expect(getScrollableFadeEdges(element, "vertical")).toEqual({ start: true, end: false });
  });

  test("ignores subpixel overflow at the end edge", () => {
    expect(getScrollableFadeEdges(measurements({ scrollLeft: 99.5, scrollWidth: 200 }))).toEqual({
      start: true,
      end: false,
    });
  });
});
