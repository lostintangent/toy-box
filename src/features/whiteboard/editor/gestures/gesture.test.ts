import { describe, expect, test } from "bun:test";
import { activeToolForGesture, gestureOwnerForPointer, gestureOwnerForTool } from "./gesture";

describe("SVG editor gesture ownership", () => {
  test("routes each active tool to its gesture source", () => {
    expect(gestureOwnerForTool("select")).toBe("selection");
    expect(gestureOwnerForTool("hand")).toBe("viewport");
    expect(gestureOwnerForTool("pen")).toBe("drawing");
    expect(gestureOwnerForTool("eraser")).toBe("drawing");
    expect(gestureOwnerForTool("text")).toBe("drawing");
    expect(gestureOwnerForTool("rectangle")).toBe("drawing");
  });

  test("temporarily toggles editable gestures between selection and navigation", () => {
    expect(activeToolForGesture({ activeTool: "hand", spacePressed: true })).toBe("select");
    expect(activeToolForGesture({ activeTool: "select", spacePressed: true })).toBe("hand");
    expect(activeToolForGesture({ activeTool: "pen", spacePressed: true })).toBe("hand");
    expect(activeToolForGesture({ activeTool: "select", spacePressed: false })).toBe("select");
  });

  test("locks navigation gestures to the viewport without stealing other buttons", () => {
    expect(gestureOwnerForPointer({ button: 0, activeTool: "hand" })).toBe("viewport");
    expect(gestureOwnerForPointer({ button: 1, activeTool: "select" })).toBe("viewport");
    expect(gestureOwnerForPointer({ button: 2, activeTool: "select" })).toBeNull();
  });
});
