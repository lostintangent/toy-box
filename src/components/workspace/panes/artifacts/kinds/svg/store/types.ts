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
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow";

export type Fill = {
  color: string;
  style: "solid" | "diagonal" | "cross" | "dots";
};

export type StyleChange =
  | { property: "color"; value: string }
  | { property: "strokeWidth"; value: number }
  | { property: "fill"; value: Fill | null }
  | { property: "fontSize"; value: number };

/** Observable state for the interaction currently pending completion or cancellation. */
export type Gesture =
  | { type: "pan" }
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

export type History = {
  undoStack: readonly HistoryEntry[];
  redoStack: readonly HistoryEntry[];
};

export type HistoryEntry =
  | {
      type: "attributes";
      transitions: readonly {
        element: Element;
        before: { namespace: string | null; name: string; value: string | null };
        after: { namespace: string | null; name: string; value: string | null };
      }[];
    }
  | {
      type: "children";
      parent: Element;
      before: readonly Node[];
      after: readonly Node[];
    }
  | { type: "compound"; entries: readonly HistoryEntry[] };

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;
