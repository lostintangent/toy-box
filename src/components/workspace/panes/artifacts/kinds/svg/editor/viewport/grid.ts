import type { Viewport } from "../../store";

const DOT_SPACING = 20;
const DOT_RADIUS = 1;
const MIN_SCREEN_DOT_SPACING = 12;
const MIN_SCREEN_DOT_RADIUS = 1;
const MAX_SCREEN_DOT_RADIUS = 3;
const DOT_FILL = {
  dark: "rgba(255, 255, 255, 0.22)",
  light: "rgba(0, 0, 0, 0.16)",
} as const;

export function calculateSvgGridMetrics(zoom: number): { spacing: number; radius: number } {
  const safeZoom = Math.max(zoom, Number.EPSILON);
  const spacingMultiplier = Math.max(
    1,
    2 ** Math.ceil(Math.log2(MIN_SCREEN_DOT_SPACING / (DOT_SPACING * safeZoom))),
  );
  const screenRadius = Math.min(
    MAX_SCREEN_DOT_RADIUS,
    Math.max(MIN_SCREEN_DOT_RADIUS, DOT_RADIUS * safeZoom),
  );
  return { spacing: DOT_SPACING * spacingMultiplier, radius: screenRadius / safeZoom };
}

export function renderSvgGrid(
  context: CanvasRenderingContext2D,
  viewport: Pick<Viewport, "zoom" | "panX" | "panY" | "size">,
  colorScheme: "dark" | "light",
): void {
  const { spacing, radius } = calculateSvgGridMetrics(viewport.zoom);
  const left = -viewport.panX;
  const top = -viewport.panY;
  const right = left + viewport.size.width / viewport.zoom;
  const bottom = top + viewport.size.height / viewport.zoom;
  const startX = Math.floor(left / spacing) * spacing;
  const startY = Math.floor(top / spacing) * spacing;
  const endX = Math.ceil(right / spacing) * spacing;
  const endY = Math.ceil(bottom / spacing) * spacing;

  context.fillStyle = DOT_FILL[colorScheme];
  context.beginPath();
  for (let x = startX; x <= endX; x += spacing) {
    for (let y = startY; y <= endY; y += spacing) {
      context.moveTo(x + radius, y);
      context.arc(x, y, radius, 0, Math.PI * 2);
    }
  }
  context.fill();
}
