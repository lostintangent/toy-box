import { CircleCheck, FlaskConical, GitBranch, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/shared/utils";
import { briefActionKey } from "../actions";
import { reopenQuestion, type BriefEdit, type Question } from "../model/index";
import { Tag } from "./vocabulary";

const ANSWER_METHOD_LABEL: Record<Question["answerMethod"], string> = {
  "investigate-code": "Check the code",
  "run-experiment": "Try it",
};

/** Open questions an agent can answer by checking the code or trying an experiment. */
export function QuestionsContent({
  questions,
  editable,
  pending,
  onInvestigateQuestion,
  onEdit,
}: {
  questions: Question[];
  editable: boolean;
  pending: ReadonlySet<string>;
  onInvestigateQuestion?: (questionId: string) => void;
  onEdit: (edit: BriefEdit) => void;
}) {
  return (
    <div className="space-y-2.5">
      {questions.map((item) => {
        const resolved = Boolean(item.answer);
        const busy = pending.has(
          briefActionKey({ action: "investigate-question", questionId: item.id }),
        );
        const experiment = item.answerMethod === "run-experiment";
        const InvestigationIcon = experiment ? FlaskConical : GitBranch;
        const investigationLabel = experiment ? "Try it" : "Check code";
        return (
          <div
            key={item.id}
            className={cn(
              "rounded-lg border border-l-2 bg-muted/20 p-2.5",
              resolved ? "border-l-emerald-500/70 opacity-70" : "border-l-rose-500",
            )}
          >
            <div className="text-[12px]">{item.question}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Tag className="bg-zinc-500/10 text-zinc-400">
                {ANSWER_METHOD_LABEL[item.answerMethod]}
              </Tag>
            </div>
            {item.impact && (
              <div className="mt-1 text-[10.5px] text-muted-foreground">{item.impact}</div>
            )}
            {resolved ? (
              <div className="mt-1">
                <div className="flex items-start gap-1 text-[10.5px] text-emerald-400">
                  <CircleCheck className="mt-0.5 size-3 shrink-0" />
                  {item.answer}
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={() => onEdit((brief) => reopenQuestion(brief, item.id))}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="size-3" />
                    Revisit question
                  </button>
                )}
              </div>
            ) : (
              (editable || busy) && (
                <button
                  type="button"
                  disabled={!onInvestigateQuestion || busy}
                  onClick={() => onInvestigateQuestion?.(item.id)}
                  className="mt-2 inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[10.5px] text-sky-400 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <InvestigationIcon className="size-3" />
                  )}
                  {busy ? "Pending..." : investigationLabel}
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
