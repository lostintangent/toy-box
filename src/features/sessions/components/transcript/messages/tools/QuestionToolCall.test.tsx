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
  expect(markup).toContain(">SQLite<");
  expect(markup).toContain(">PostgreSQL<");
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
  expect(markup).not.toContain("SQLite");
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

test("keeps HTML-like choices and recorded answers visible", () => {
  const pending = renderQuestion({
    question: "Pick one.",
    choices: ["<Widget>"],
    allowFreeform: false,
    state: "pending",
    requestId: "request-1",
  });
  expect(pending).toContain("&lt;Widget&gt;");

  const answered = renderQuestion({
    question: "Pick one.",
    allowFreeform: false,
    state: "answered",
    answer: "<Widget>",
  });
  expect(answered).toContain("&lt;Widget&gt;");
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
