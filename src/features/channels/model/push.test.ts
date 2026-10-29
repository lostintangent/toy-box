import { expect, test } from "bun:test";
import { channelLead, type Channel, type ChannelMessage } from ".";
import { notificationPayload, updatePayload } from "@push/server/apns";
import {
  channelActivityContent,
  channelActivityState,
  channelNotification,
  channelBadgeCount,
  type ChannelActivityState,
} from "./push";

const timestamp = 1793086200;
const registrationID = "00000000-0000-4000-8000-000000000001";

const content: ChannelActivityState = {
  workingAgents: [{ id: "studio-demo", name: "Lead" }],
  tasksDone: 1,
  tasksTotal: 3,
};
const cases: { file: string; state: ChannelActivityState }[] = [
  { file: "push-activity", state: { ...content, waitingRequestSequence: 15 } },
  {
    file: "push-activity-completed",
    state: { ...content, workingAgents: [], tasksDone: 3, ending: "completed" },
  },
];
for (const { file, state } of cases)
  test(`encodes the shared Swift fixture ${file}`, async () => {
    const fixture: unknown = await Bun.file(
      new URL(`./__fixtures__/${file}.apns`, import.meta.url),
    ).json();
    expect<unknown>(
      updatePayload(
        {
          type: "update",
          value: state,
          attention: state.waitingRequestSequence,
          ending: !!state.ending,
          render: (at, limit) => channelActivityContent(state, at, limit),
        },
        timestamp,
      ),
    ).toEqual(fixture);
  });

const channel: Channel = {
  id: "studio-demo",
  name: "Studio",
  model: { provider: "copilot", name: "test" },
  tasks: [{ id: "one", title: "Ship the door", status: "done" }],
  latestSequence: 16,
  seenThrough: 0,
  requestSequence: 15,
  completedSequence: 16,
  updatedAt: "2026-10-28T00:00:00Z",
};

for (const kind of ["request", "completion"] as const)
  test(`${kind} carries display-ready channel text, grouping and routing without a badge`, () => {
    const sequence = kind === "request" ? 15 : 16;
    const message: ChannelMessage =
      kind === "request"
        ? {
            id: "question",
            sequence,
            timestamp: channel.updatedAt,
            sender: { type: "agent", agentId: channel.id },
            content: "@lead Which **door**?",
            request: true,
          }
        : {
            id: "completion",
            sequence,
            timestamp: channel.updatedAt,
            sender: { type: "system" },
            content: { type: "tasks_completed" },
          };
    const payload: Record<string, unknown> = notificationPayload(
      channelNotification(kind, channel, message, [channelLead(channel.id)]),
      registrationID,
    );
    expect(payload).toEqual({
      aps: {
        alert: {
          title: "Studio",
          body: kind === "request" ? "Which door?" : "Completed \u201cShip the door\u201d",
        },
        category: kind,
        sound: "default",
        "mutable-content": 1,
        "thread-id": `${registrationID}:${channel.id}`,
      },
      kind,
      channelID: channel.id,
      sequence,
      registrationID,
      ...(kind === "request" ? { handle: "lead" } : {}),
    });
  });

test("badge counts channels with open requests, even when read, not unread or completed channels", () => {
  expect(
    channelBadgeCount([
      { ...channel, seenThrough: 100 },
      { ...channel, id: "second", requestSequence: 99 },
      { ...channel, id: "completed", requestSequence: null, completedSequence: 16 },
      { ...channel, id: "unread", requestSequence: null, completedSequence: null },
    ]),
  ).toBe(2);
  expect(channelBadgeCount([{ ...channel, requestSequence: null }])).toBe(0);
  expect(channelBadgeCount([])).toBe(0);
});

test("optional art can be omitted, but agents and progress cannot be truncated to fit", () => {
  const state = {
    ...content,
    workingAgents: Array.from({ length: 20 }, (_, index) => ({
      id: `agent-${index}`,
      name: `Agent ${index}`,
      avatar: { mark: "M0 0 ".repeat(1000), color: "#123456" },
    })),
  };
  const payload = channelActivityContent(state, timestamp, 3500);
  expect(payload).toEqual({
    ...state,
    workingAgents: state.workingAgents.map(({ id, name }) => ({ id, name })),
    updatedAt: timestamp,
  });
  expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(3500);
  expect(state.workingAgents[0]!.avatar).toBeDefined();
  const tooLarge = {
    ...state,
    workingAgents: state.workingAgents.map((agent) => ({ ...agent, id: "x".repeat(255) })),
  };
  expect(channelActivityContent(tooLarge, timestamp, 3500).workingAgents).toEqual(
    tooLarge.workingAgents.map(({ id, name }) => ({ id, name })),
  );
  expect(() =>
    updatePayload(
      {
        type: "update",
        ending: false,
        value: tooLarge,
        render: (at, limit) => channelActivityContent(tooLarge, at, limit),
      },
      timestamp,
    ),
  ).toThrow("4096-byte");
});

test("projection counts only roots and uses actual presence rather than stored working status", () => {
  const done: Channel["tasks"][number] = {
    id: "one",
    title: "One",
    status: "done",
    children: [{ id: "child", title: "Child", status: "pending" }],
  };
  const state = {
    channel: {
      tasks: [done, { id: "two", title: "Two", status: "in_progress" }],
      requestSequence: 15,
    },
    lead: channelLead("studio-demo", { state: "working", text: "Old status" }),
    members: [{ id: "member", channelId: "studio-demo", name: "Member" }],
    presence: { "studio-demo": { state: "idle" }, member: { state: "working" } },
  } satisfies Parameters<typeof channelActivityState>[0];
  const projected = channelActivityState(state);
  expect(projected).toMatchObject({
    workingAgents: [{ id: "member", name: "Member" }],
    tasksDone: 1,
    tasksTotal: 2,
    waitingRequestSequence: 15,
  });
  expect(projected).not.toHaveProperty("updatedAt");
  expect(channelActivityContent(projected, timestamp, 4096).updatedAt).toBe(timestamp);
  for (const [tasks, ending] of [
    [[], "tasksRemoved"],
    [[done], "completed"],
  ] as const) {
    const terminal = channelActivityState({
      ...state,
      channel: { ...state.channel, tasks: [...tasks] },
    });
    expect(terminal.ending).toBe(ending);
    expect(
      updatePayload(
        {
          type: "update",
          value: terminal,
          ending: true,
          render: (at, limit) => channelActivityContent(terminal, at, limit),
        },
        timestamp,
      ),
    ).toMatchObject({ aps: { event: "end", "dismissal-date": timestamp + 900 } });
  }
});
