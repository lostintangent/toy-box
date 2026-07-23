import { describe, expect, test } from "bun:test";
import {
  DEFAULT_VIEWPORT,
  fitViewport,
  panViewport,
  resolveViewport,
  toDocumentPoint,
  zoomViewport,
} from "./viewport";

describe("SVG editor viewport", () => {
  test("centers an authored SVG page and leaves breathing room", () => {
    expect(fitViewport({ x: -100, y: 50, width: 1_000, height: 500 }, 1000, 600)).toEqual({
      zoom: 0.9,
      panX: 155.55555555555554,
      panY: 33.333333333333314,
    });
  });

  test("keeps extremely large diagrams visible at the minimum zoom", () => {
    expect(fitViewport({ x: 0, y: 0, width: 1_000_000, height: 1_000_000 }, 300, 200).zoom).toBe(
      0.01,
    );
  });

  test("maps viewport points into SVG document coordinates", () => {
    const viewport = {
      ...DEFAULT_VIEWPORT,
      zoom: 2,
      panX: -10,
      panY: 20,
      size: { width: 800, height: 600 },
    };

    expect(viewport.size).toEqual({ width: 800, height: 600 });
    expect(toDocumentPoint(viewport, { x: 100, y: 80 })).toEqual({ x: 60, y: 20 });
  });

  test("resolves page and bounds fitting as explicit viewport policy", () => {
    const page = { x: 0, y: 0, width: 100, height: 100 };
    const viewportSize = { width: 1_000, height: 1_000 };
    expect(resolveViewport({ type: "fit-page" }, page, viewportSize).zoom).toBe(1);
    expect(resolveViewport({ type: "fit-bounds", bounds: page }, page, viewportSize).zoom).toBe(9);
  });

  test("zooms around a stable viewport point", () => {
    const viewport = {
      ...DEFAULT_VIEWPORT,
      zoom: 2,
      panX: -10,
      panY: 20,
      size: { width: 800, height: 600 },
    };
    const center = { x: 400, y: 300 };
    const documentPoint = toDocumentPoint(viewport, center);
    const zoomed = { ...viewport, ...zoomViewport(viewport, "in") };

    expect(toDocumentPoint(zoomed, center)).toEqual(documentPoint);
    expect(zoomed.zoom).toBeGreaterThan(viewport.zoom);
  });

  test("pans by viewport-space distance at every zoom level", () => {
    const viewport = {
      ...DEFAULT_VIEWPORT,
      zoom: 2,
      panX: -10,
      panY: 20,
    };

    expect(panViewport(viewport, { x: 40, y: -20 })).toEqual({
      zoom: 2,
      panX: 10,
      panY: 10,
    });
  });
});
