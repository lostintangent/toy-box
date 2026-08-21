import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { CircleHelp } from "lucide-react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useCurrentSession } from "../../../CurrentSessionContext";
import { sessionMutations } from "../../../../mutations";
import type { SessionQuestion } from "../../../../model";

export function QuestionToolCall({ question }: { question: SessionQuestion }) {
  const { sessionId, mode } = useCurrentSession();

  return (
    <div className="w-full rounded-lg border border-border/70 bg-background/80 p-3 text-sm shadow-xs">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <CircleHelp className="size-4" aria-hidden />
        <span>Question</span>
      </div>
      <Streamdown
        plugins={{ code }}
        className="text-sm [&_p]:my-2 [&_pre]:my-2 [&_ul]:my-2 [&_ol]:my-2"
      >
        {question.question}
      </Streamdown>

      {question.state === "answered" ? (
        <div className="mt-3 border-t pt-3">
          <div className="mb-1 text-xs text-muted-foreground">Answer</div>
          <div className="whitespace-pre-wrap">{question.answer}</div>
        </div>
      ) : question.state === "unanswered" ? (
        <p className="mt-3 text-xs text-muted-foreground">No answer was recorded.</p>
      ) : mode !== "passive" ? (
        <QuestionAnswerForm sessionId={sessionId} question={question} />
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Waiting for input.</p>
      )}
    </div>
  );
}

function QuestionAnswerForm({
  sessionId,
  question,
}: {
  sessionId: string;
  question: Extract<SessionQuestion, { state: "pending" }>;
}) {
  const answerMutation = useMutation(sessionMutations.answerSessionQuestion(sessionId));
  const [freeformAnswer, setFreeformAnswer] = useState("");

  const submitAnswer = (answer: string, wasFreeform: boolean) => {
    answerMutation.mutate({
      requestId: question.requestId,
      answer,
      wasFreeform,
    });
  };
  const handleFreeformSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const answer = freeformAnswer.trim();
    if (!answer) return;
    submitAnswer(answer, true);
  };

  return (
    <div className="mt-3 space-y-2">
      {question.choices && question.choices.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {question.choices.map((choice) => (
            <Button
              key={choice}
              type="button"
              variant="outline"
              size="sm"
              disabled={answerMutation.isPending}
              onClick={() => submitAnswer(choice, false)}
            >
              {choice}
            </Button>
          ))}
        </div>
      )}
      {question.allowFreeform && (
        <form className="flex gap-2" onSubmit={handleFreeformSubmit}>
          <Input
            value={freeformAnswer}
            disabled={answerMutation.isPending}
            placeholder="Type an answer"
            aria-label="Freeform answer"
            onChange={(event) => setFreeformAnswer(event.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            disabled={answerMutation.isPending || freeformAnswer.trim().length === 0}
          >
            Submit
          </Button>
        </form>
      )}
      {answerMutation.isError && (
        <p className="text-xs text-destructive">The answer could not be submitted.</p>
      )}
    </div>
  );
}
