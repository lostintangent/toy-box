import { describe, expect, test } from "bun:test";
import {
  createMessageWindow,
  reconcileMessageWindow,
  revealPreviousMessageWindow,
} from "./virtualization";

const range = (count: number) => [...Array(count).keys()];

describe("message virtualization window", () => {
  test("renders every message while the transcript fits in one window", () => {
    expect(createMessageWindow(range(4), 5)).toEqual({ startPosition: 0, lastPosition: 3 });
  });

  test("starts a long transcript at its latest window", () => {
    expect(createMessageWindow(range(12), 5)).toEqual({ startPosition: 7, lastPosition: 11 });
  });

  test("keeps a pinned transcript bounded as messages append", () => {
    const current = createMessageWindow(range(12), 5);

    expect(reconcileMessageWindow(current, range(15), true, 5)).toEqual({
      startPosition: 10,
      lastPosition: 14,
    });
  });

  test("crosses from a small to a large pinned transcript without changing window size", () => {
    const current = createMessageWindow(range(4), 5);

    expect(reconcileMessageWindow(current, range(7), true, 5)).toEqual({
      startPosition: 2,
      lastPosition: 6,
    });
  });

  test("retains the reader's earliest mounted message when output appends below", () => {
    const current = createMessageWindow(range(12), 5);

    expect(reconcileMessageWindow(current, range(15), false, 5)).toEqual({
      startPosition: 7,
      lastPosition: 14,
    });
  });

  test("does not collapse expanded history merely because the reader returns to the bottom", () => {
    const current = revealPreviousMessageWindow(createMessageWindow(range(20), 5), range(20), 5);

    expect(reconcileMessageWindow(current, range(20), true, 5)).toBe(current);
  });

  test("collapses expanded history when pinned output appends", () => {
    const current = revealPreviousMessageWindow(createMessageWindow(range(20), 5), range(20), 5);

    expect(reconcileMessageWindow(current, range(22), true, 5)).toEqual({
      startPosition: 17,
      lastPosition: 21,
    });
  });

  test("reveals history in chunks and clamps at the first message", () => {
    const current = createMessageWindow(range(12), 5);

    expect(revealPreviousMessageWindow(current, range(12), 5)).toEqual({
      startPosition: 2,
      lastPosition: 11,
    });
    expect(
      revealPreviousMessageWindow({ startPosition: 2, lastPosition: 11 }, range(12), 5),
    ).toEqual({ startPosition: 0, lastPosition: 11 });
  });

  test("resets to the latest window when a transcript is replaced by a shorter one", () => {
    expect(
      reconcileMessageWindow({ startPosition: 10, lastPosition: 19 }, range(7), false, 5),
    ).toEqual({ startPosition: 2, lastPosition: 6 });
  });

  test("preserves identity when the transcript's end is unchanged", () => {
    const current = createMessageWindow(range(12), 5);

    expect(reconcileMessageWindow(current, range(12), true, 5)).toBe(current);
  });

  test("a previous page leaves the window in place, then reveals across the seam", () => {
    const current = createMessageWindow([10, 12, 15, 16], 2);
    expect(current).toEqual({ startPosition: 15, lastPosition: 16 });

    const withPreviousPage = [3, 5, 10, 12, 15, 16];
    expect(reconcileMessageWindow(current, withPreviousPage, false, 2)).toBe(current);
    expect(revealPreviousMessageWindow(current, withPreviousPage, 2)).toEqual({
      startPosition: 10,
      lastPosition: 16,
    });
  });
});
