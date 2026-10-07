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
    ownerId: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional()
      .describe("The channel lead ID or current member ID responsible for the task."),
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
        "Measured lines directly attributed to this task. Exclude subtask counts; parent totals are computed automatically.",
      ),
    get children() {
      return z.array(channelTaskSchema).max(50).optional().describe("Optional subtasks.");
    },
  })
  .strict();

export type ChannelTask = z.output<typeof channelTaskSchema>;

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
  .omit({ id: true, children: true })
  .partial()
  .extend({
    ownerId: channelTaskSchema.shape.ownerId.nullable(),
    artifactId: channelTaskSchema.shape.artifactId.nullable(),
    diff: channelTaskSchema.shape.diff.nullable(),
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
              "Move the existing subtree intact. Its new parent must be outside that subtree.",
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

export function unassignChannelTasks(
  tasks: readonly ChannelTask[],
  agentId: string,
): ChannelTask[] {
  return tasks.map(({ ownerId, children, ...task }) => ({
    ...task,
    ...(ownerId && ownerId !== agentId ? { ownerId } : {}),
    ...(children ? { children: unassignChannelTasks(children, agentId) } : {}),
  }));
}

/** A task list is complete when it has tasks and every task and subtask is done. */
export function channelTasksComplete(tasks: readonly ChannelTask[]): boolean {
  const allDone = (tasks: readonly ChannelTask[]): boolean =>
    tasks.every(({ status, children = [] }) => status === "done" && allDone(children));
  return tasks.length > 0 && allDone(tasks);
}
