import { z } from "zod";
import { diffStatsSchema, type DiffStats } from "@/shared/diffStats";
import { applyPatch, hasChanges } from "./changes";

const taskIdSchema = z.string().trim().min(1).max(255);

export const channelTaskSchema = z
  .object({
    id: taskIdSchema.describe(
      "A short stable ID unique within the channel, such as t1 or t12. Preserve it when editing.",
    ),
    title: z.string().trim().min(1).max(240).describe("A concise outcome or next step."),
    status: z.enum(["pending", "in_progress", "blocked", "done"]),
    startedAt: z.iso
      .datetime()
      .optional()
      .describe(
        "Server-owned start time, set when the task enters in_progress and cleared when it leaves. Do not set it.",
      ),
    checkInAt: z.iso
      .datetime()
      .optional()
      .describe(
        "Optional UTC check-in time that keeps in-progress work on track, independent of startedAt and checked once a minute. Only the lead sets it. When due, the owner is privately prompted to report whether the work is converging, and the check-in is cleared.",
      ),
    ownerId: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional()
      .describe(
        "The channel lead or a current member responsible for the task, by agent ID or @mention.",
      ),
    artifactId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The artifactId of this task's own outcome, returned by sharing or reading an artifact in this channel. Do not copy subtask artifact references to a parent.",
      ),
    diff: diffStatsSchema
      .optional()
      .describe(
        "Measured lines directly attributed to this task, omitting uncertain counts and unrelated work. Exclude subtask counts; parent totals are computed automatically. These are reported-work totals, not net repository diffs.",
      ),
    get children() {
      return z.array(channelTaskSchema).max(50).optional().describe("Optional subtasks.");
    },
  })
  .strict();

export type ChannelTask = z.output<typeof channelTaskSchema>;

/** Reconcile server-owned timing by stable ID against the last committed tree. */
export function reconcileChannelTaskTiming(
  previous: readonly ChannelTask[],
  next: readonly ChannelTask[],
  now: string,
): ChannelTask[] {
  const byId = new Map<string, ChannelTask>();
  const remember = (tasks: readonly ChannelTask[]) => {
    for (const task of tasks) {
      byId.set(task.id, task);
      if (task.children) remember(task.children);
    }
  };
  remember(previous);
  const visit = (tasks: readonly ChannelTask[]): ChannelTask[] =>
    tasks.map(({ startedAt: _startedAt, checkInAt, children, ...task }) => {
      const startedAt =
        task.status === "in_progress" ? (byId.get(task.id)?.startedAt ?? now) : undefined;
      return {
        ...task,
        ...(startedAt ? { startedAt } : {}),
        ...(task.status !== "done" && checkInAt ? { checkInAt } : {}),
        ...(children ? { children: visit(children) } : {}),
      };
    });
  return visit(next);
}

export function channelTaskElapsedMinutes(
  { startedAt }: Pick<ChannelTask, "startedAt">,
  now: number,
): number | undefined {
  return startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000)) : undefined;
}

export const channelTasksSchema = z
  .array(channelTaskSchema)
  .max(50)
  .superRefine((tasks, context) => {
    const ids = new Set<string>();
    const visit = (tasks: readonly ChannelTask[], path: (string | number)[]) => {
      tasks.forEach((task, index) => {
        if (ids.has(task.id)) {
          context.addIssue({
            code: "custom",
            message: `Task ID "${task.id}" is already in use in this channel.`,
            path: [...path, index, "id"],
          });
        }
        ids.add(task.id);
        if (task.children) visit(task.children, [...path, index, "children"]);
      });
    };
    visit(tasks, []);
  });

/** Sum reported work across task trees without storing derived totals. */
export function channelTasksDiff(tasks: readonly ChannelTask[]): DiffStats | undefined {
  return tasks
    .flatMap(({ diff, children = [] }) => [diff, channelTasksDiff(children)])
    .reduce<DiffStats | undefined>((total, diff) => {
      if (!diff) return total;
      return {
        added: (total?.added ?? 0) + diff.added,
        removed: (total?.removed ?? 0) + diff.removed,
      };
    }, undefined);
}

const taskPatchSchema = channelTaskSchema
  .omit({ id: true, children: true, startedAt: true })
  .partial()
  .extend({
    ownerId: channelTaskSchema.shape.ownerId.nullable(),
    artifactId: channelTaskSchema.shape.artifactId.nullable(),
    diff: channelTaskSchema.shape.diff.nullable(),
    checkInAt: channelTaskSchema.shape.checkInAt.nullable(),
  })
  .refine(hasChanges, { message: "Change at least one task field." });

export const editChannelTasksInputSchema = z
  .object({
    operations: z
      .array(
        z.discriminatedUnion("type", [
          z
            .object({
              type: z.literal("add"),
              parentId: taskIdSchema.optional().describe("Omit to append a top-level task."),
              task: channelTaskSchema,
            })
            .strict(),
          z
            .object({
              type: z.literal("update"),
              taskId: taskIdSchema,
              patch: taskPatchSchema.describe(
                "Omitted fields and children stay unchanged. Null clears an optional field.",
              ),
            })
            .strict(),
          z.object({ type: z.literal("remove"), taskId: taskIdSchema }).strict(),
          z
            .object({
              type: z.literal("move"),
              taskId: taskIdSchema,
              parentId: taskIdSchema.optional().describe("Omit to append a top-level task."),
            })
            .strict()
            .describe(
              "Move the existing subtree intact, keeping its IDs, artifacts, and diffs. Its new parent must be outside that subtree. When a group is full, first move a task to the root to make room for a milestone, then move tasks into it in the same batch.",
            ),
        ]),
      )
      .min(1)
      .describe("Applied in order as one atomic edit. Removing a task removes its subtree."),
  })
  .strict();

export type EditChannelTasksInput = z.output<typeof editChannelTasksInputSchema>;

/** Each operation preserves a valid tree; the caller commits only the final result. */
export function applyChannelTaskEdits(
  tasks: readonly ChannelTask[],
  operations: EditChannelTasksInput["operations"],
): ChannelTask[] {
  return operations.reduce<ChannelTask[]>(
    (current, operation) => {
      switch (operation.type) {
        case "add":
        case "move": {
          const inserted = operation.type === "add" ? [operation.task] : [];
          // Detaching first makes self and descendant destinations unreachable.
          const remaining =
            operation.type === "move"
              ? changeTask(current, operation.taskId, (task) => {
                  inserted.push(task);
                  return null;
                })
              : current;
          return channelTasksSchema.parse(
            operation.parentId
              ? changeTask(remaining, operation.parentId, (parent) => ({
                  ...parent,
                  children: [...(parent.children ?? []), ...inserted],
                }))
              : [...remaining, ...inserted],
          );
        }
        case "update":
          return changeTask(current, operation.taskId, (task) => applyPatch(task, operation.patch));
        case "remove":
          return changeTask(current, operation.taskId, () => null);
      }
    },
    [...tasks],
  );
}

function changeTask(
  tasks: readonly ChannelTask[],
  taskId: string,
  change: (task: ChannelTask) => ChannelTask | null,
): ChannelTask[] {
  let found = false;
  const visit = (tasks: readonly ChannelTask[]): ChannelTask[] =>
    tasks.flatMap((task) => {
      if (task.id === taskId) {
        found = true;
        const next = change(task);
        return next ? [next] : [];
      }
      return [task.children ? { ...task, children: visit(task.children) } : task];
    });
  const next = visit(tasks);
  if (!found) throw new Error(`Task "${taskId}" was not found in this channel.`);
  return next;
}

/** Clears the `link` that names `id` at every depth, such as an agent's ownership or an artifact's link. */
export function unlinkChannelTasks(
  tasks: readonly ChannelTask[],
  link: "ownerId" | "artifactId",
  id: string,
): ChannelTask[] {
  return tasks.map((task) => {
    const { [link]: linked, children, ...rest } = task;
    return {
      ...rest,
      ...(linked && linked !== id ? { [link]: linked } : {}),
      ...(children ? { children: unlinkChannelTasks(children, link, id) } : {}),
    };
  });
}

/** A task list is complete when it has tasks and every task and subtask is done. */
export function channelTasksComplete(tasks: readonly ChannelTask[]): boolean {
  const allDone = (tasks: readonly ChannelTask[]): boolean =>
    tasks.every(({ status, children = [] }) => status === "done" && allDone(children));
  return tasks.length > 0 && allDone(tasks);
}
