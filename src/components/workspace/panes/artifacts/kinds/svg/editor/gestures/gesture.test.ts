import { describe, expect, test } from "bun:test";
import {
  activeToolForGesture,
  gestureOwnerForPointer,
  gestureOwnerForState,
  gestureOwnerForTool,
} from "./gesture";

describe("SVG editor gesture ownership", () => {
  test("routes each active tool to its gesture source", () => {
    expect(gestureOwnerForTool("select")).toBe("selection");
    expect(gestureOwnerForTool("hand")).toBe("viewport");
    expect(gestureOwnerForTool("pen")).toBe("drawing");
    expect(gestureOwnerForTool("eraser")).toBe("drawing");
    expect(gestureOwnerForTool("text")).toBe("drawing");
    expect(gestureOwnerForTool("rectangle")).toBe("drawing");
  });

  test("retains source ownership in semantic editor gesture state", () => {
    expect(gestureOwnerForState({ type: "pan" })).toBe("viewport");
    expect(gestureOwnerForState({ type: "draw" })).toBe("drawing");
    expect(
      gestureOwnerForState({
        type: "insert-text",
        documentPoint: { x: 0, y: 0 },
        viewportPoint: { x: 0, y: 0 },
      }),
    ).toBe("drawing");
    expect(gestureOwnerForState({ type: "transform", mode: "move" })).toBe("selection");
    expect(
      gestureOwnerForState({ type: "marquee", rect: { x: 0, y: 0, width: 0, height: 0 } }),
    ).toBe("selection");
  });

  test("temporarily toggles editable gestures between selection and navigation", () => {
    expect(activeToolForGesture({ activeTool: "hand", spacePressed: true, readOnly: false })).toBe(
      "select",
    );
    expect(
      activeToolForGesture({ activeTool: "select", spacePressed: true, readOnly: false }),
    ).toBe("hand");
    expect(activeToolForGesture({ activeTool: "pen", spacePressed: true, readOnly: false })).toBe(
      "hand",
    );
    expect(activeToolForGesture({ activeTool: "hand", spacePressed: true, readOnly: true })).toBe(
      "hand",
    );
    expect(
      activeToolForGesture({ activeTool: "select", spacePressed: false, readOnly: false }),
    ).toBe("select");
  });

  test("locks navigation gestures to the viewport without stealing other buttons", () => {
    expect(gestureOwnerForPointer({ button: 0, activeTool: "hand" })).toBe("viewport");
    expect(gestureOwnerForPointer({ button: 1, activeTool: "select" })).toBe("viewport");
    expect(gestureOwnerForPointer({ button: 2, activeTool: "select" })).toBeNull();
  });
});
