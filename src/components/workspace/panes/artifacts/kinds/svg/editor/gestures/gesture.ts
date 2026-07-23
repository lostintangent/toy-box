import type { Gesture, Tool } from "../../store";

export type GestureOwner = "viewport" | "drawing" | "selection";
export type GestureOutcome = "commit" | "cancel";

/** Owns every pointer update after a gesture source claims pointer-down. */
export type GestureController<Event> = {
  update: (event: Event) => void;
  finish: (outcome: GestureOutcome) => void;
};

/** Offers pointer-down to one editor capability and optionally claims it with a controller. */
export type GestureSource<Event> = {
  owner: GestureOwner;
  claim: (event: Event) => GestureController<Event> | null;
  hover?: {
    update: (event: Event) => void;
    leave: () => void;
  };
};

/** Resolves the active gesture tool while Space is held. */
export function activeToolForGesture({
  activeTool,
  spacePressed,
  readOnly,
}: {
  activeTool: Tool;
  spacePressed: boolean;
  readOnly: boolean;
}): Tool {
  if (readOnly || !spacePressed) return activeTool;
  return activeTool === "hand" ? "select" : "hand";
}

/** Selects which editor source may claim a pointer gesture. */
export function gestureOwnerForPointer({
  button,
  activeTool,
}: {
  button: number;
  activeTool: Tool;
}): GestureOwner | null {
  if (button === 1) return "viewport";
  if (button !== 0) return null;
  return gestureOwnerForTool(activeTool);
}

export function gestureOwnerForTool(activeTool: Tool): GestureOwner {
  if (activeTool === "hand") return "viewport";
  return activeTool === "select" ? "selection" : "drawing";
}

/** Recovers ownership from the semantic gesture exposed through editor state. */
export function gestureOwnerForState(gesture: Gesture): GestureOwner {
  if (gesture.type === "pan") return "viewport";
  if (gesture.type === "draw" || gesture.type === "insert-text") return "drawing";
  return "selection";
}
