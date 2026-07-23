import { describe, expect, test } from "bun:test";
import { DOMParser } from "@xmldom/xmldom";
import { renderSelectionFrame } from "./SelectionLayer";

describe("SVG selection layer", () => {
  test("renders member outlines and one interactive selection frame", () => {
    const document = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="first"/><rect id="second"/><svg id="overlay"/></svg>',
      "image/svg+xml",
    );
    const first = document.getElementById("first") as unknown as SVGGraphicsElement;
    const second = document.getElementById("second") as unknown as SVGGraphicsElement;
    const overlay = document.getElementById("overlay") as unknown as SVGSVGElement;
    overlay.replaceChildren = (...nodes: Node[]) => {
      while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
      for (const node of nodes) overlay.appendChild(node);
    };
    first.getBBox = () => ({ x: 10, y: 20, width: 100, height: 60 }) as DOMRect;
    first.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) as DOMMatrix;
    second.getBBox = () => ({ x: 150, y: 30, width: 50, height: 40 }) as DOMRect;
    second.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) as DOMMatrix;

    renderSelectionFrame(overlay, [first], { left: 0, top: 0 }, true);

    const outline = overlay.getElementsByTagName("polygon")[0];
    expect(outline?.getAttribute("stroke")).toBe("var(--user-accent)");
    expect(outline?.getAttribute("stroke-width")).toBe("2");
    expect(outline?.getAttribute("stroke-dasharray")).toBe("4 3");

    renderSelectionFrame(overlay, [first, second], { left: 0, top: 0 }, true);
    expect(overlay.getElementsByTagName("polygon")).toHaveLength(3);
    expect(overlay.getElementsByTagName("circle")).toHaveLength(9);
  });
});
