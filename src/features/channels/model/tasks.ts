import { z } from "zod";
import { diffStatsSchema, type DiffStats } from "@/shared/diffStats";
import { channelActorSchema, type ChannelActor } from "./agent";
import { applyPatch, hasChanges } from "./changes";

const taskIdSchema = z.string().trim().min(1).max(255);

export const channelTaskSchema = z
  .object({
    id: taskIdSchema.describe("A short stable ID unique within the channel, such as t1 or t12."),
    title: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe("A concise outcome or next step, without commit hashes or measurements."),
    status: z.enum(["pending", "in_progress", "blocked", "done"]),
    /** Set while the task is in_progress, by the server alone. */
    startedAt: z.iso.datetime().optional(),
    checkInAt: z.iso
      .datetime()
      .optional()
      .describe(
        "Optional UTC check-in time, checked once a minute. When due, the owner is privately prompted to report whether the work is converging, and the check-in is cleared.",
      ),
    owner: channelActorSchema.optional(),
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

/** A task as tools write and read it: its owner is a handle, and its start time stays on the server. */
export const channelTaskInputSchema = channelTaskSchema.omit({ startedAt: true }).extend({
  owner: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional()
    .describe(
      "The lead or a current member responsible for the task, by @mention, or @user when the task waits on the user.",
    ),
  get children() {
    return z.array(channelTaskInputSchema).max(50).optional().describe("Optional subtasks.");
  },
});

export type ChannelTaskInput = z.output<typeof channelTaskInputSchema>;

/** Write each owner back as a reference, for tools to read or for edits to apply to. */
export function nameChannelTaskOwners(
  tasks: readonly ChannelTask[],
  name: (owner: ChannelActor) => string | undefined,
): ChannelTaskInput[] {
  return tasks.map(({ owner, startedAt: _startedAt, children, ...task }) => ({
    ...task,
    ...(owner && { owner: name(owner) }),
    ...(children && { children: nameChannelTaskOwners(children, name) }),
  }));
}

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

const channelTasksInputSchema = z
  .array(channelTaskInputSchema)
  .max(50)
  .superRefine((tasks, context) => {
    const ids = new Set<string>();
    const visit = (tasks: readonly ChannelTaskInput[], path: (string | number)[]) => {
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

const taskPatchSchema = channelTaskInputSchema
  .omit({ id: true, children: true })
  .partial()
  .extend({
    owner: channelTaskInputSchema.shape.owner.nullable(),
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
              task: channelTaskInputSchema,
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
      .describe("Applied in order. Removing a task removes its subtree."),
  })
  .strict();

export type EditChannelTasksInput = z.output<typeof editChannelTasksInputSchema>;

/** Each operation preserves a valid tree; the caller commits only the final result. */
export function applyChannelTaskEdits(
  tasks: readonly ChannelTaskInput[],
  operations: EditChannelTasksInput["operations"],
): ChannelTaskInput[] {
  return operations.reduce<ChannelTaskInput[]>(
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
          return channelTasksInputSchema.parse(
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
  tasks: readonly ChannelTaskInput[],
  taskId: string,
  change: (task: ChannelTaskInput) => ChannelTaskInput | null,
): ChannelTaskInput[] {
  let found = false;
  const visit = (tasks: readonly ChannelTaskInput[]): ChannelTaskInput[] =>
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
  link: "owner" | "artifactId",
  id: string,
): ChannelTask[] {
  return tasks.map(({ children, ...task }) => {
    const { [link]: linked, ...rest } = task;
    const linkedId =
      typeof linked === "object" && linked.type === "agent" ? linked.agentId : linked;
    return {
      ...(linkedId === id ? rest : task),
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
