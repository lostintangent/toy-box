import { describe, expect, test } from "bun:test";
import type { Message } from ".";
import { createInitialSessionState } from "./reducer";
import { joinPreviousMessages, latestMessages, messagesBefore } from "./transcriptPages";

// Five 400 KB messages: a 1 MiB page holds two of them.
const message = (id: number, size = 400_000): Message => ({
  role: "assistant",
  content: `${id}:${"x".repeat(size)}`,
});
const messages = [0, 1, 2, 3, 4].map((id) => message(id));
const state = createInitialSessionState({ messages });

describe("transcript pages", () => {
  test("the latest page keeps trailing messages within the budget, and always one", () => {
    expect(latestMessages(state)).toEqual({
      ...state,
      messages: messages.slice(3),
      messageOffset: 3,
    });

    const oversized = message(5, 3_000_000);
    expect(latestMessages({ ...state, messages: [...messages, oversized] })).toMatchObject({
      messages: [oversized],
      messageOffset: 5,
    });
  });

  test("pages walk back to the whole transcript", () => {
    const middle = messagesBefore(messages, 3);
    expect(middle).toEqual({ messages: messages.slice(1, 4), messageOffset: 1 });

    const joined = joinPreviousMessages(
      messagesBefore(messages, 1),
      joinPreviousMessages(middle, latestMessages(state)),
    );
    expect(joined).toEqual({ ...state, messageOffset: 0 });
  });

  test("a mismatched seam or a gap leaves the newer state alone", () => {
    // A rewind replaced the message at the newer state's first position.
    const rewound = { ...state, messages: [message(8), message(9)], messageOffset: 2 };
    expect(joinPreviousMessages(messagesBefore(messages, 3), rewound)).toBe(rewound);

    // A page read after a rewind ends before the page it was requested for.
    const latest = latestMessages(state);
    expect(joinPreviousMessages(messagesBefore(messages.slice(0, 2), 3), latest)).toBe(latest);
  });
});
