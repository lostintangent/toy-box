import { describe, expect, test } from "bun:test";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@workspace/model/config/layoutPrefs";
import { SIDEBAR_COLLAPSED_WIDTH, resolveSidebarDrag } from "./SidebarResizer";

describe("sidebar drag", () => {
  test("keeps a dragged width, rounded to whole pixels", () => {
    expect(resolveSidebarDrag(320.4)).toEqual({ collapsed: false, width: 320 });
  });

  test("clamps a drag to the sidebar's usable range", () => {
    expect(resolveSidebarDrag(SIDEBAR_MAX_WIDTH + 200)).toEqual({
      collapsed: false,
      width: SIDEBAR_MAX_WIDTH,
    });
    expect(resolveSidebarDrag(SIDEBAR_MIN_WIDTH + 1)).toEqual({
      collapsed: false,
      width: SIDEBAR_MIN_WIDTH + 1,
    });
  });

  test("collapses once the drag passes halfway to the rail", () => {
    const midpoint = (SIDEBAR_COLLAPSED_WIDTH + SIDEBAR_MIN_WIDTH) / 2;
    expect(resolveSidebarDrag(midpoint)).toEqual({ collapsed: false, width: SIDEBAR_MIN_WIDTH });
    expect(resolveSidebarDrag(midpoint - 1)).toEqual({ collapsed: true });
  });
});
