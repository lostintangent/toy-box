import { describe, expect, test } from "bun:test";
import {
  createMessageWindow,
  reconcileMessageWindow,
  revealPreviousMessageWindow,
} from "./virtualization";

describe("message virtualization window", () => {
  test("renders every message while the transcript fits in one window", () => {
    expect(createMessageWindow(4, 5)).toEqual({ startIndex: 0, messageCount: 4 });
  });

  test("starts a long transcript at its latest window", () => {
    expect(createMessageWindow(12, 5)).toEqual({ startIndex: 7, messageCount: 12 });
  });

  test("keeps a pinned transcript bounded as messages append", () => {
    const current = createMessageWindow(12, 5);

    expect(reconcileMessageWindow(current, 15, true, 5)).toEqual({
      startIndex: 10,
      messageCount: 15,
    });
  });

  test("crosses from a small to a large pinned transcript without changing window size", () => {
    const current = createMessageWindow(4, 5);

    expect(reconcileMessageWindow(current, 7, true, 5)).toEqual({
      startIndex: 2,
      messageCount: 7,
    });
  });

  test("retains the reader's earliest mounted message when output appends below", () => {
    const current = createMessageWindow(12, 5);

    expect(reconcileMessageWindow(current, 15, false, 5)).toEqual({
      startIndex: 7,
      messageCount: 15,
    });
  });

  test("does not collapse expanded history merely because the reader returns to the bottom", () => {
    const current = revealPreviousMessageWindow(createMessageWindow(20, 5), 5);

    expect(reconcileMessageWindow(current, 20, true, 5)).toBe(current);
  });

  test("collapses expanded history when pinned output appends", () => {
    const current = revealPreviousMessageWindow(createMessageWindow(20, 5), 5);

    expect(reconcileMessageWindow(current, 22, true, 5)).toEqual({
      startIndex: 17,
      messageCount: 22,
    });
  });

  test("reveals history in chunks and clamps at the first message", () => {
    const current = createMessageWindow(12, 5);

    expect(revealPreviousMessageWindow(current, 5)).toEqual({
      startIndex: 2,
      messageCount: 12,
    });
    expect(revealPreviousMessageWindow({ startIndex: 2, messageCount: 12 }, 5)).toEqual({
      startIndex: 0,
      messageCount: 12,
    });
  });

  test("resets to the latest window when a transcript is replaced by a shorter one", () => {
    expect(reconcileMessageWindow({ startIndex: 10, messageCount: 20 }, 7, false, 5)).toEqual({
      startIndex: 2,
      messageCount: 7,
    });
  });

  test("preserves identity when the message count is unchanged", () => {
    const current = createMessageWindow(12, 5);

    expect(reconcileMessageWindow(current, 12, true, 5)).toBe(current);
  });
});
