import { useMemo } from "react";
import { Check, Circle, CircleSlash, ListTodo, Loader2, type LucideIcon } from "lucide-react";
import type { TodoItem, TodoStatus } from "@/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InputGroupButton } from "@/components/ui/input-group";

export interface TodoPopupProps {
  todos?: TodoItem[];
  isStreaming?: boolean;
}

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

export function TodoPopup({ todos, isStreaming }: TodoPopupProps) {
  const displayTodos = useMemo(
    () => getDisplayTodos(todos ?? [], isStreaming),
    [todos, isStreaming],
  );
  const completedCount = displayTodos.filter((todo) => todo.status === "done").length;
  const totalCount = displayTodos.length;

  if (!todos?.length || totalCount === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <InputGroupButton size="icon-xs" aria-label="View todos">
          <ListTodo className="h-4 w-4" />
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="text-sm">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">
              Todos ({completedCount}/{totalCount})
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
