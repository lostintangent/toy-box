import { describe, expect, test } from "bun:test";
import { DOMParser } from "@xmldom/xmldom";
import {
  createAttributesHistoryEntry,
  createChildrenHistoryEntry,
  createCompoundHistoryEntry,
  recordHistoryEntry,
  redoHistory,
  snapshotAttribute,
  undoHistory,
} from "./history";

const parser = new DOMParser();

function parse(source: string): Element {
  const root = parser.parseFromString(source, "image/svg+xml").documentElement;
  if (!root) throw new Error("Expected a document element");
  return root as unknown as Element;
}

describe("SVG DOM history", () => {
  test("undoes and redoes a completed attribute gesture as one history entry", () => {
    const root = parse(
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="cloud" transform="translate(10 20)" /></svg>',
    );
    const cloud = root.getElementsByTagName("g")[0];
    const before = snapshotAttribute(cloud, "transform");
    cloud.setAttribute("transform", "matrix(2 0 0 2 40 60)");
    const entry = createAttributesHistoryEntry([
      { element: cloud, before, after: snapshotAttribute(cloud, "transform") },
    ])!;
    const history = recordHistoryEntry({ undoStack: [], redoStack: [] }, entry);

    const undone = undoHistory(history)!;
    expect(cloud.getAttribute("transform")).toBe("translate(10 20)");
    expect(undone.redoStack).toHaveLength(1);

    const redone = redoHistory(undone)!;
    expect(cloud.getAttribute("transform")).toBe("matrix(2 0 0 2 40 60)");
    expect(redone.undoStack).toHaveLength(1);
  });

  test("retains arbitrary rich subtrees across add and delete history", () => {
    const root = parse('<svg xmlns="http://www.w3.org/2000/svg"><defs /></svg>');
    const before = Array.from(root.childNodes);
    const scene = parse(
      '<g xmlns="http://www.w3.org/2000/svg" id="scene"><path d="M0 0C10 20 30 40 50 60" /><filter id="f"><feGaussianBlur stdDeviation="2" /></filter></g>',
    );
    root.appendChild(scene);
    const entry = createChildrenHistoryEntry(root, before, Array.from(root.childNodes))!;
    const history = recordHistoryEntry({ undoStack: [], redoStack: [] }, entry);

    const undone = undoHistory(history)!;
    expect(root.getElementsByTagName("g")).toHaveLength(0);

    redoHistory(undone);
    expect(root.getElementsByTagName("path")).toHaveLength(1);
    expect(root.getElementsByTagName("filter")).toHaveLength(1);
  });

  test("omits a text history entry when browser undo restores the starting subtree", () => {
    const text = parse(
      '<text xmlns="http://www.w3.org/2000/svg"><tspan font-weight="700">Water</tspan> cycle</text>',
    );
    const before = Array.from(text.childNodes, (node) => node.cloneNode(true));
    const after = Array.from(text.childNodes, (node) => node.cloneNode(true));

    expect(createChildrenHistoryEntry(text, before, after)).toBeNull();
  });

  test("applies compound entries in reverse order when undoing", () => {
    const root = parse(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red" /><circle /></svg>',
    );
    const rect = root.getElementsByTagName("rect")[0];
    const beforeFill = snapshotAttribute(rect, "fill");
    rect.setAttribute("fill", "blue");
    const style = createAttributesHistoryEntry([
      { element: rect, before: beforeFill, after: snapshotAttribute(rect, "fill") },
    ]);
    const beforeChildren = Array.from(root.childNodes);
    root.removeChild(rect);
    const deletion = createChildrenHistoryEntry(root, beforeChildren, Array.from(root.childNodes));
    const entry = createCompoundHistoryEntry([style, deletion])!;
    const history = recordHistoryEntry({ undoStack: [], redoStack: [] }, entry);

    const undone = undoHistory(history)!;
    expect(root.getElementsByTagName("rect")[0]?.getAttribute("fill")).toBe("red");

    redoHistory(undone);
    expect(root.getElementsByTagName("rect")).toHaveLength(0);
  });

  test("drops redo history after a new mutation", () => {
    const root = parse('<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>');
    const rect = root.firstChild as unknown as Element;
    const before = snapshotAttribute(rect, "opacity");
    rect.setAttribute("opacity", "0.5");
    const first = createAttributesHistoryEntry([
      { element: rect, before, after: snapshotAttribute(rect, "opacity") },
    ])!;
    const undone = undoHistory(recordHistoryEntry({ undoStack: [], redoStack: [] }, first))!;
    rect.setAttribute("opacity", "0.75");
    const second = createAttributesHistoryEntry([
      { element: rect, before, after: snapshotAttribute(rect, "opacity") },
    ])!;

    expect(recordHistoryEntry(undone, second).redoStack).toHaveLength(0);
  });
});
