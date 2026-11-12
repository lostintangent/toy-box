import type { Fill, History, Point, Rect, ShapeTool, Size } from "../document";

/** The complete runtime editing layer over one authoritative native SVG document. */
export type EditorState = {
  readOnly: boolean;
  viewport: Viewport;

  activeTool: Tool;
  /** Retained defaults for new elements; supported selection edits bypass them. */
  styleDefaults: {
    /** Null follows the current theme foreground. */
    color: string | null;
    fill: Fill | null;
    strokeWidth: number;
    fontSize: number;
  };

  /** Native nodes in the currently loaded document. */
  selection: readonly SVGGraphicsElement[];
  gesture: Gesture | null;

  /** Reversible native-DOM edits for the currently loaded document. */
  history: History;
};

export type Tool =
  // Navigation
  | "hand"
  | "select"

  // Free-form/text
  | "pen"
  | "eraser"
  | "text"

  // Shapes
  | ShapeTool;

/** Observable state for the interaction currently pending completion or cancellation. */
export type Gesture =
  | { type: "pan" }
  | { type: "pinch" }
  | { type: "draw" }
  | { type: "insert-text"; documentPoint: Point; viewportPoint: Point }
  | { type: "pending-move" }
  | { type: "transform"; mode: "move" | "resize" | "rotate" }
  | { type: "line-endpoint" }
  | { type: "marquee"; rect: Rect };

export type Viewport = {
  mode: { type: "fit-page" } | { type: "fit-bounds"; bounds: Rect } | { type: "manual" };
  zoom: number;
  panX: number;
  panY: number;
  size: Size;
};
