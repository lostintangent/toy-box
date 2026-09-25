import { Check, Circle, CircleSlash, ListTodo, Loader2, type LucideIcon } from "lucide-react";
import type { TodoItem, TodoStatus } from "../../model";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { emptyOutputPillClassName, outputPillClassName } from "./ArtifactPill";

type DisplayTodo = TodoItem & {
  displayStatus: TodoStatus;
};

const STATUS_CONFIG: Record<
  TodoStatus,
  {
    icon: LucideIcon;
    iconClassName: string;
    textClassName: string;
  }
> = {
  done: {
    icon: Check,
    iconClassName: "text-green-500",
    textClassName: "text-muted-foreground",
  },
  in_progress: {
    icon: Loader2,
    iconClassName: "animate-spin text-muted-foreground",
    textClassName: "text-foreground",
  },
  pending: {
    icon: Circle,
    iconClassName: "text-muted-foreground",
    textClassName: "text-foreground",
  },
  blocked: {
    icon: CircleSlash,
    iconClassName: "text-destructive",
    textClassName: "text-foreground",
  },
};

function getDisplayTodos(todos: TodoItem[], isStreaming?: boolean): DisplayTodo[] {
  const hasActiveTodo = todos.some((todo) => todo.status === "in_progress");
  let promotedPending = false;

  return todos.map((todo) => {
    if (isStreaming && !hasActiveTodo && !promotedPending && todo.status === "pending") {
      promotedPending = true;
      return { ...todo, displayStatus: "in_progress" };
    }
    return { ...todo, displayStatus: todo.status };
  });
}

export function TodoPopup({ todos, isStreaming }: { todos?: TodoItem[]; isStreaming?: boolean }) {
  const displayTodos = getDisplayTodos(todos ?? [], isStreaming);
  const completedCount = displayTodos.filter((todo) => todo.status === "done").length;
  if (displayTodos.length === 0) {
    return (
      <span className={emptyOutputPillClassName}>
        <ListTodo className="size-3.5 shrink-0" />
        0/0
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label="View todos"
        className={outputPillClassName}
        render={<button type="button" />}
      >
        <ListTodo className="size-3.5 shrink-0" />
        {completedCount}/{displayTodos.length}
        <span className="h-1 w-8 overflow-hidden rounded-full bg-muted max-sm:hidden">
          <span
            className="block h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${(completedCount / displayTodos.length) * 100}%` }}
          />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" side="top">
        <div className="text-sm">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">
              Todos ({completedCount}/{displayTodos.length})
            </span>
          </div>
          <div className="px-3 py-2">
            <ul className="space-y-1">
              {displayTodos.map((todo) => {
                const {
                  icon: Icon,
                  iconClassName,
                  textClassName,
                } = STATUS_CONFIG[todo.displayStatus];
                return (
                  <li key={todo.id} className="flex items-start gap-2 text-xs">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClassName}`} />
                    <span className={textClassName}>{todo.title}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
