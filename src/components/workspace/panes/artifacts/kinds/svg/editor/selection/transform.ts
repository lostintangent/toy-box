// Preserves native element transforms while applying screen-space selection gestures.

import type { Point } from "../../store";
import type { SelectionFrame, SelectionHandle } from "./frame";

export type Matrix2D = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

/** Native transform context needed to apply one screen-space gesture losslessly. */
export type ElementTransformCapture = {
  element: SVGGraphicsElement;
  originalScreenMatrix: Matrix2D;
  parentScreenInverse: Matrix2D;
  beforeTransform: string | null;
};

const MIN_RESIZE_SCALE = 0.05;
const ROTATION_SNAP_DEGREES = 15;

/** Captures a complete selection so one gesture never transforms only part of it. */
export function captureSelectionTransforms(
  elements: readonly SVGGraphicsElement[],
): readonly ElementTransformCapture[] | null {
  const captures: ElementTransformCapture[] = [];
  for (const element of elements) {
    const capture = captureElementTransform(element);
    if (!capture) return null;
    captures.push(capture);
  }
  return captures;
}

/** Applies a screen-space gesture without losing the element's existing nested transform. */
export function applyScreenTransform(
  capture: ElementTransformCapture,
  screenTransform: Matrix2D,
): void {
  const nextLocalMatrix = multiplyMatrices(
    capture.parentScreenInverse,
    multiplyMatrices(screenTransform, capture.originalScreenMatrix),
  );
  capture.element.setAttribute("transform", serializeMatrix(nextLocalMatrix));
}

/** Resizes a selection in its own screen-space frame around its opposite side or center. */
export function resizeSelectionTransform({
  frame,
  handle,
  start,
  pointer,
  fromCenter = false,
  preserveAspectRatio = false,
}: {
  frame: SelectionFrame;
  handle: SelectionHandle;
  start: Point;
  pointer: Point;
  fromCenter?: boolean;
  preserveAspectRatio?: boolean;
}): Matrix2D | null {
  const direction = resizeDirection(handle);
  if (!direction) return null;

  const xAxis = subtractPoints(frame.corners[1], frame.corners[0]);
  const yAxis = subtractPoints(frame.corners[3], frame.corners[0]);
  const handlePoint = framePoint(frame, {
    x: direction.x < 0 ? 0 : direction.x > 0 ? 1 : 0.5,
    y: direction.y < 0 ? 0 : direction.y > 0 ? 1 : 0.5,
  });
  const anchor = fromCenter
    ? frame.center
    : framePoint(frame, {
        x: direction.x < 0 ? 1 : direction.x > 0 ? 0 : 0.5,
        y: direction.y < 0 ? 1 : direction.y > 0 ? 0 : 0.5,
      });
  const frameBasis = {
    a: xAxis.x,
    b: xAxis.y,
    c: yAxis.x,
    d: yAxis.y,
    e: anchor.x,
    f: anchor.y,
  };
  const inverseBasis = invertMatrix(frameBasis);
  if (!inverseBasis) return null;

  const startInFrame = transformPoint(inverseBasis, handlePoint);
  const pointerInFrame = transformPoint(inverseBasis, {
    x: handlePoint.x + pointer.x - start.x,
    y: handlePoint.y + pointer.y - start.y,
  });
  let scaleX =
    direction.x === 0 ? 1 : Math.max(MIN_RESIZE_SCALE, pointerInFrame.x / startInFrame.x);
  let scaleY =
    direction.y === 0 ? 1 : Math.max(MIN_RESIZE_SCALE, pointerInFrame.y / startInFrame.y);

  if (preserveAspectRatio && direction.x !== 0 && direction.y !== 0) {
    const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    scaleX = scale;
    scaleY = scale;
  }

  return multiplyMatrices(frameBasis, multiplyMatrices(scaleMatrix(scaleX, scaleY), inverseBasis));
}

/** Rotates a selection around its center, optionally snapping the gesture delta. */
export function rotateSelectionTransform({
  center,
  start,
  pointer,
  snap = false,
}: {
  center: Point;
  start: Point;
  pointer: Point;
  snap?: boolean;
}): Matrix2D {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const pointerAngle = Math.atan2(pointer.y - center.y, pointer.x - center.x);
  let degrees = ((pointerAngle - startAngle) * 180) / Math.PI;
  if (snap) degrees = Math.round(degrees / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES;
  return transformAroundPoint(rotationMatrix(degrees), center);
}

/** Matrix multiplication using SVG's column-vector convention. */
export function multiplyMatrices(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function invertMatrix(matrix: Matrix2D): Matrix2D | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < Number.EPSILON) return null;
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

export function translationMatrix(x: number, y: number): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function scaleMatrix(scaleX: number, scaleY = scaleX): Matrix2D {
  return { a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 };
}

export function rotationMatrix(degrees: number): Matrix2D {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0 };
}

export function transformAroundPoint(matrix: Matrix2D, center: Point): Matrix2D {
  return multiplyMatrices(
    translationMatrix(center.x, center.y),
    multiplyMatrices(matrix, translationMatrix(-center.x, -center.y)),
  );
}

export function transformPoint(matrix: Matrix2D, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function matrixFromDom(matrix: DOMMatrixReadOnly): Matrix2D {
  return {
    a: matrix.a,
    b: matrix.b,
    c: matrix.c,
    d: matrix.d,
    e: matrix.e,
    f: matrix.f,
  };
}

export function serializeMatrix(matrix: Matrix2D): string {
  const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map((value) =>
    Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(6)),
  );
  return `matrix(${values.join(" ")})`;
}

function resizeDirection(handle: SelectionHandle): Point | null {
  switch (handle) {
    case "resize-nw":
      return { x: -1, y: -1 };
    case "resize-n":
      return { x: 0, y: -1 };
    case "resize-ne":
      return { x: 1, y: -1 };
    case "resize-e":
      return { x: 1, y: 0 };
    case "resize-se":
      return { x: 1, y: 1 };
    case "resize-s":
      return { x: 0, y: 1 };
    case "resize-sw":
      return { x: -1, y: 1 };
    case "resize-w":
      return { x: -1, y: 0 };
    case "rotate":
    case "line-start":
    case "line-end":
      return null;
  }
}

function framePoint(frame: SelectionFrame, point: Point): Point {
  const xAxis = subtractPoints(frame.corners[1], frame.corners[0]);
  const yAxis = subtractPoints(frame.corners[3], frame.corners[0]);
  return {
    x: frame.corners[0].x + xAxis.x * point.x + yAxis.x * point.y,
    y: frame.corners[0].y + xAxis.y * point.x + yAxis.y * point.y,
  };
}

function subtractPoints(left: Point, right: Point): Point {
  return { x: left.x - right.x, y: left.y - right.y };
}

function captureElementTransform(element: SVGGraphicsElement): ElementTransformCapture | null {
  const elementScreen = element.getScreenCTM();
  const parentScreen = getParentScreenMatrix(element);
  if (!elementScreen || !parentScreen) return null;
  const parentScreenInverse = invertMatrix(matrixFromDom(parentScreen));
  if (!parentScreenInverse) return null;
  return {
    element,
    originalScreenMatrix: matrixFromDom(elementScreen),
    parentScreenInverse,
    beforeTransform: element.getAttribute("transform"),
  };
}

function getParentScreenMatrix(element: SVGGraphicsElement): DOMMatrix | null {
  const parent = element.parentElement;
  if (!parent || !("getScreenCTM" in parent)) return null;
  return (parent as unknown as SVGGraphicsElement).getScreenCTM();
}
