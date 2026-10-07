import { expect, test } from "bun:test";
import {
  applyChannelTaskEdits,
  channelTasksDiff,
  channelTasksComplete,
  editChannelTasksInputSchema,
  type ChannelTask,
  type EditChannelTasksInput,
} from "./tasks";

const task = (id: string): ChannelTask => ({ id, title: id, status: "pending" });

test("ordered edits target IDs, preserve omitted outcomes and descendants, and clear explicit nulls", () => {
  const tasks = [
    {
      ...task("t1"),
      children: [
        {
          ...task("t2"),
          ownerId: "critic",
          artifactId: "session:critic:review.md",
          diff: { added: 12, removed: 3 },
          children: [task("t3")],
        },
        { ...task("t4"), children: [task("t6")] },
      ],
    },
  ];
  const before = structuredClone(tasks);
  const { operations } = editChannelTasksInputSchema.parse({
    operations: [
      {
        type: "update",
        taskId: "t2",
        patch: { title: "Revised review", ownerId: null, diff: null },
      },
      { type: "add", parentId: "t2", task: task("t5") },
      { type: "remove", taskId: "t4" },
    ],
  });
  expect(applyChannelTaskEdits(tasks, operations)).toEqual([
    {
      ...task("t1"),
      children: [
        {
          id: "t2",
          title: "Revised review",
          status: "pending",
          artifactId: "session:critic:review.md",
          children: [task("t3"), task("t5")],
        },
      ],
    },
  ]);
  expect(tasks).toEqual(before);
});

test("edits reject unknown targets, duplicate IDs across branches, and a 51st subtask", () => {
  const tasks = applyChannelTaskEdits(
    [{ ...task("t1"), children: Array.from({ length: 49 }, (_, index) => task(`t${index + 2}`)) }],
    [
      { type: "add", parentId: "t1", task: task("t51") },
      { type: "add", task: task("t52") },
    ],
  );
  expect(tasks[0]!.children).toHaveLength(50);
  for (const operation of [
    { type: "update", taskId: "missing", patch: { status: "done" } },
    { type: "add", task: task("t2") },
    { type: "add", parentId: "t1", task: task("t53") },
    { type: "move", taskId: "t52", parentId: "t1" },
  ] satisfies EditChannelTasksInput["operations"]) {
    expect(() => applyChannelTaskEdits(tasks, [operation])).toThrow();
  }
});

test("a full group can move existing outcomes into a milestone without restating them", () => {
  const outcome = {
    ...task("t2"),
    artifactId: "machine:/review.md",
    diff: { added: 12, removed: 3 },
    children: [{ ...task("t100"), diff: { added: 0, removed: 0 } }],
  };
  const siblings = Array.from({ length: 49 }, (_, index) => task(`t${index + 3}`));
  const root = { ...task("t1"), children: [outcome, ...siblings] };
  const before = structuredClone(root);
  const { operations } = editChannelTasksInputSchema.parse({
    operations: [
      { type: "move", taskId: outcome.id },
      { type: "add", parentId: root.id, task: task("t52") },
      { type: "move", taskId: outcome.id, parentId: "t52" },
    ],
  });
  expect(applyChannelTaskEdits([root], operations)).toEqual([
    { ...before, children: [...siblings, { ...task("t52"), children: [before.children[0]] }] },
  ]);
  for (const parentId of [root.id, "t100"]) {
    expect(() =>
      applyChannelTaskEdits([root], [{ type: "move", taskId: root.id, parentId }]),
    ).toThrow("not found");
  }
  expect(root).toEqual(before);
});

test.each([{ id: "t3" }, { children: [] }])(
  "patches cannot replace identity or descendants: %j",
  (patch) => {
    expect(
      editChannelTasksInputSchema.safeParse({
        operations: [{ type: "update", taskId: "t1", patch: { title: "Revised", ...patch } }],
      }).success,
    ).toBe(false);
  },
);

test("parent and whole-list totals count direct work and descendants exactly once", () => {
  const parent: ChannelTask = {
    ...task("t1"),
    diff: { added: 5, removed: 1 },
    children: [
      {
        ...task("t2"),
        diff: { added: 10, removed: 4 },
        children: [{ ...task("t3"), diff: { added: 7, removed: 2 } }],
      },
      task("t4"),
    ],
  };
  const before = structuredClone(parent);
  expect(channelTasksDiff([parent])).toEqual({ added: 22, removed: 7 });
  expect(channelTasksDiff([parent, { ...task("t5"), diff: { added: 3, removed: 2 } }])).toEqual({
    added: 25,
    removed: 9,
  });
  expect(parent).toEqual(before);
});

test("unreported diffs stay absent while an explicitly reported zero survives roll-up", () => {
  expect(channelTasksDiff([{ ...task("t1"), children: [task("t2")] }])).toBeUndefined();
  expect(
    channelTasksDiff([
      {
        ...task("t1"),
        children: [{ ...task("t2"), diff: { added: 0, removed: 0 } }],
      },
    ]),
  ).toEqual({ added: 0, removed: 0 });
});

test("a task list is complete only when it has tasks and every subtask is done", () => {
  const release = (status: ChannelTask["status"]): ChannelTask => ({
    ...task("t1"),
    status: "done",
    children: [{ ...task("t2"), status }],
  });
  expect(channelTasksComplete([])).toBe(false);
  expect(channelTasksComplete([{ ...task("t1"), status: "in_progress" }])).toBe(false);
  expect(channelTasksComplete([release("blocked")])).toBe(false);
  expect(channelTasksComplete([release("done"), { ...task("t3"), status: "done" }])).toBe(true);
});
