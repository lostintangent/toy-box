import { describe, expect, test } from "bun:test";
import type { Message, SessionQuestion } from "./index";
import { hasBlockingSessionQuestion, hasPendingSessionQuestion } from "./questions";

function questionMessage(...questions: SessionQuestion[]): Message {
  return {
    role: "assistant",
    content: "",
    toolCalls: questions.map((question, index) => ({
      id: `question-${index}`,
      name: "ask_user",
      arguments: {},
      question,
    })),
  };
}

describe("session question queries", () => {
  test("finds a pending request by its public identity", () => {
    const session = {
      messages: [
        questionMessage(
          { question: "Old?", allowFreeform: true, state: "unanswered" },
          {
            question: "Current?",
            allowFreeform: true,
            state: "pending",
            requestId: "request-1",
          },
        ),
      ],
    };

    expect(hasPendingSessionQuestion(session, "request-1")).toBe(true);
    expect(hasPendingSessionQuestion(session, "missing")).toBe(false);
  });

  test("derives waiting only from pending blocking questions", () => {
    const nonblocking = {
      question: "Optional?",
      allowFreeform: true,
      blocking: false,
      state: "pending",
      requestId: "background",
    } satisfies SessionQuestion;
    const blocking = {
      question: "Continue?",
      allowFreeform: true,
      state: "pending",
      requestId: "blocking",
    } satisfies SessionQuestion;

    expect(hasBlockingSessionQuestion({ messages: [questionMessage(nonblocking)] })).toBe(false);
    expect(hasBlockingSessionQuestion({ messages: [questionMessage(nonblocking, blocking)] })).toBe(
      true,
    );
    expect(
      hasBlockingSessionQuestion({
        messages: [
          questionMessage({
            question: "Done?",
            allowFreeform: true,
            state: "answered",
            answer: "Yes",
          }),
        ],
      }),
    ).toBe(false);
  });
});
