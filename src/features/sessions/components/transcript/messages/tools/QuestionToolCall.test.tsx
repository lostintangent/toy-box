import { expect, onTestFinished, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionQuestion, ToolCall } from "../../../../model";
import { CurrentSessionProvider, type SessionPaneMode } from "../../../CurrentSessionContext";
import { ToolCallMessage } from "./ToolCallMessage";

test("renders an active pending question with choices and freeform input", () => {
  const markup = renderQuestion(
    {
      question: "Choose **one** database.",
      choices: ["SQLite", "PostgreSQL"],
      allowFreeform: true,
      state: "pending",
      requestId: "request-1",
    },
    "active",
  );

  expect(markup).toContain("one");
  expect(markup).not.toContain("**one**");
  expect(markup).toContain(">SQLite</button>");
  expect(markup).toContain(">PostgreSQL</button>");
  expect(markup).toContain('aria-label="Freeform answer"');
  expect(markup).toContain(">Submit</button>");
});

test("renders a passive pending question without answer controls", () => {
  const markup = renderQuestion(
    {
      question: "Pick a database.",
      choices: ["SQLite", "PostgreSQL"],
      allowFreeform: true,
      state: "pending",
      requestId: "request-1",
    },
    "passive",
  );

  expect(markup).toContain("Waiting for input.");
  expect(markup).not.toContain(">SQLite</button>");
  expect(markup).not.toContain('aria-label="Freeform answer"');
});

test("renders resolved and terminal unanswered questions read-only", () => {
  const answered = renderQuestion({
    question: "Which database?",
    choices: ["SQLite", "PostgreSQL"],
    allowFreeform: true,
    state: "answered",
    answer: "SQLite",
  });
  expect(answered).toContain(">Answer<");
  expect(answered).toContain(">SQLite<");
  expect(answered).not.toContain('aria-label="Freeform answer"');

  const unanswered = renderQuestion({
    question: "Which database?",
    allowFreeform: true,
    state: "unanswered",
  });
  expect(unanswered).toContain("No answer was recorded.");
  expect(unanswered).not.toContain('aria-label="Freeform answer"');
});

function renderQuestion(question: SessionQuestion, mode: SessionPaneMode = "active"): string {
  const toolCall: ToolCall = {
    id: "question-1",
    name: "ask_user",
    arguments: { question: question.question },
    question,
  };
  const queryClient = new QueryClient();
  onTestFinished(() => queryClient.clear());
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <CurrentSessionProvider value={{ sessionId: "session-1", mode }}>
        <ToolCallMessage toolCall={toolCall} isActive />
      </CurrentSessionProvider>
    </QueryClientProvider>,
  );
}
