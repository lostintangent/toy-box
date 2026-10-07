import { expect, test } from "bun:test";
import { machineFile } from "@files/model";
import {
  channelLead,
  channelHasUnreadCompletion,
  type ChannelConversationMessage,
  type ChannelMessage,
  type ChannelSystemMessageContent,
  type ChannelState,
} from ".";
import { mergeChannelMessages, reduceChannelState } from "./reducer";

const message = (sequence: number): ChannelConversationMessage => ({
  id: `message-${sequence}`,
  sequence,
  sender: { type: "user" },
  content: `Message ${sequence}`,
  timestamp: "2026-10-03T20:00:00.000Z",
});

function snapshot(): ChannelState {
  return {
    channel: {
      id: "channel",
      name: "Studio",
      model: { provider: "codex", name: "gpt-5.5" },
      tasks: [],
      latestSequence: 101,
      seenThrough: 0,
      requestSequence: null,
      completedSequence: null,
      updatedAt: "2026-10-03T20:00:00.000Z",
    },
    revision: 101,
    lead: channelLead("channel"),
    members: [],
    messages: [message(1), message(101)],
    artifacts: [],
    routines: [],
    request: null,
    presence: { channel: { state: "idle" } },
  };
}

test("recovery snapshots replace stale older history", () => {
  const previous = snapshot();
  const current = {
    ...previous,
    revision: 103,
    messages: [message(101)],
  };
  expect(reduceChannelState(previous, { type: "snapshot", state: current })).toBe(current);
});

function system(sequence: number, content: ChannelSystemMessageContent) {
  return {
    type: "message" as const,
    revision: sequence,
    message: {
      id: `system-${sequence}`,
      sequence,
      sender: { type: "system" as const },
      content,
      timestamp: "2026-10-03T21:00:00.000Z",
    },
  };
}

test("quiet tasks and model changes advance the cursor without creating transcript activity", () => {
  const previous = snapshot();
  previous.channel.requestSequence = 100;
  previous.channel.completedSequence = 101;
  const tasks = [
    {
      id: "build",
      title: "Build",
      status: "in_progress" as const,
      artifactId: "machine:/workspace/design.md",
      diff: { added: 12, removed: 3 },
    },
  ];
  const tasked = reduceChannelState(previous, { type: "tasks", revision: 102, tasks });
  expect(tasked.channel).toEqual({ ...previous.channel, tasks });
  expect(tasked.messages).toBe(previous.messages);
  const event = {
    type: "model" as const,
    revision: 103,
    model: { provider: "codex" as const, name: "gpt-5.5-mini" },
    updatedAt: "2026-10-03T21:00:00.000Z",
  };
  const changed = reduceChannelState(tasked, event);
  expect(changed.channel).toEqual({
    ...tasked.channel,
    model: event.model,
    updatedAt: event.updatedAt,
  });
  expect(changed.revision).toBe(103);
  expect(changed.messages).toBe(previous.messages);
  for (const revision of [event.revision, event.revision - 1]) {
    expect(reduceChannelState(changed, { ...event, revision })).toBe(changed);
  }
});

test("metadata messages update the public channel alongside transcript activity", () => {
  const actor = { type: "user" as const };
  const events = [
    system(102, { type: "channel_renamed", actor, name: "Release" }),
    system(103, { type: "channel_purpose_changed", actor, purpose: "Ship it" }),
    system(104, { type: "channel_directory_changed", actor, directory: "/work" }),
    system(105, { type: "preview_changed", actor, previewUrl: "/preview" }),
  ];
  const changed = events.reduce(reduceChannelState, snapshot());
  expect(changed.channel).toMatchObject({
    name: "Release",
    purpose: "Ship it",
    directory: "/work",
    previewUrl: "/preview",
    latestSequence: 105,
    updatedAt: events[0]!.message.timestamp,
  });
  const cleared = [
    system(106, { type: "channel_purpose_changed", actor, purpose: null }),
    system(107, { type: "channel_directory_changed", actor, directory: null }),
    system(108, { type: "preview_changed", actor, previewUrl: null }),
  ].reduce(reduceChannelState, changed);
  expect([cleared.channel.purpose, cleared.channel.directory, cleared.channel.previewUrl]).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(cleared.messages.slice(-7).map(({ sequence }) => sequence)).toEqual([
    102, 103, 104, 105, 106, 107, 108,
  ]);
});

test("a pending request survives paging and reading, receives reactions, and clears on a later user reply", () => {
  const otherReaction = { agentId: "designer", reaction: "done" as const };
  const question = {
    ...message(102),
    sender: { type: "agent" as const, agentId: "channel" },
    reactions: [otherReaction],
    request: true as const,
  };
  const previous = snapshot();
  previous.request = { ...question, id: "earlier-request", sequence: 1 };
  previous.channel.requestSequence = 1;
  const requested = reduceChannelState(previous, {
    type: "message",
    revision: 102,
    message: question,
  });
  expect(requested.request).toBe(question);
  expect(requested.channel.requestSequence).toBe(102);
  const completed = reduceChannelState(requested, system(104, { type: "tasks_completed" }));
  expect(completed.channel.completedSequence).toBe(104);
  const partiallyRead = reduceChannelState(completed, {
    type: "read",
    revision: 105,
    seenThrough: 103,
  });
  expect(channelHasUnreadCompletion(partiallyRead.channel)).toBe(true);
  const loadedReaction = reduceChannelState(partiallyRead, {
    type: "reaction",
    revision: 106,
    sequence: 102,
    agentId: "reviewer",
    reaction: "agree",
  });
  expect<ChannelMessage | null | undefined>(loadedReaction.request).toEqual(
    loadedReaction.messages.find(({ sequence }) => sequence === question.sequence),
  );
  expect(loadedReaction.request?.reactions).toEqual([
    otherReaction,
    { agentId: "reviewer", reaction: "agree" },
  ]);
  const paged = {
    ...loadedReaction,
    channel: { ...loadedReaction.channel, latestSequence: 200 },
    messages: [message(200)],
    revision: 200,
  };
  const read = reduceChannelState(paged, {
    type: "read",
    revision: 201,
    seenThrough: 200,
  });
  expect(read.channel).toMatchObject({
    seenThrough: 200,
    completedSequence: 104,
    requestSequence: 102,
  });
  expect(read.request).toBe(loadedReaction.request);
  expect(channelHasUnreadCompletion(read.channel)).toBe(false);
  const reacted = reduceChannelState(read, {
    type: "reaction",
    revision: 202,
    sequence: 102,
    agentId: "reviewer",
    reaction: "love",
  });
  expect(reacted.request?.reactions).toEqual([
    otherReaction,
    { agentId: "reviewer", reaction: "love" },
  ]);
  expect(reacted.messages).toEqual(paged.messages);
  const clearedReaction = reduceChannelState(reacted, {
    type: "reaction",
    revision: 203,
    sequence: 102,
    agentId: "reviewer",
    reaction: null,
  });
  expect(clearedReaction.request?.reactions).toEqual([otherReaction]);
  const noReactions = reduceChannelState(clearedReaction, {
    type: "reaction",
    revision: 204,
    sequence: 102,
    agentId: "designer",
    reaction: null,
  });
  expect(noReactions.request?.reactions).toBeUndefined();
  const replied = reduceChannelState(noReactions, {
    type: "message",
    revision: 205,
    message: message(201),
  });
  expect(replied.request).toBeNull();
  expect(replied.channel.requestSequence).toBeNull();
});

test("presence replaces the reconnect baseline or merges sparse live changes without advancing durable state", () => {
  const previous = {
    ...snapshot(),
    presence: { channel: { state: "idle" as const }, removed: { state: "idle" as const } },
  };
  const presence = { channel: { state: "working" as const } };
  const baseline = reduceChannelState(previous, { type: "resumed", presence });
  expect(baseline.presence).toBe(presence);
  const live = reduceChannelState(baseline, {
    type: "presence",
    presence: { reviewer: { state: "waiting", text: "Review" } },
  });
  expect(live.presence).toEqual({ ...presence, reviewer: { state: "waiting", text: "Review" } });
  expect(live).toEqual({ ...previous, presence: live.presence });
  expect(live.channel).toBe(previous.channel);
});

test("member departure removes its presence and recursively releases task ownership", () => {
  const member = { channelId: "channel", id: "reviewer", name: "Reviewer" };
  const outcome = { artifactId: "session:reviewer:review.md", diff: { added: 12, removed: 3 } };
  const previous = snapshot();
  previous.members = [member];
  previous.presence[member.id] = { state: "working" };
  previous.channel.tasks = [
    {
      id: "release",
      title: "Release",
      status: "in_progress",
      ownerId: member.id,
      children: [
        { id: "review", title: "Review", status: "pending", ownerId: member.id, ...outcome },
        { id: "ship", title: "Ship", status: "pending", ownerId: "channel" },
      ],
    },
  ];
  const departed = reduceChannelState(previous, system(102, { type: "member_left", member }));
  expect(departed.members).toEqual([]);
  expect(departed.presence).toEqual({ channel: { state: "idle" } });
  expect(departed.channel.tasks).toEqual([
    {
      id: "release",
      title: "Release",
      status: "in_progress",
      children: [
        { id: "review", title: "Review", status: "pending", ...outcome },
        { id: "ship", title: "Ship", status: "pending", ownerId: "channel" },
      ],
    },
  ]);
  expect(previous.channel.tasks[0]!.ownerId).toBe(member.id);
});

test("local posts preserve server cursors and reconcile by identity across interleaved commits", () => {
  const previous = snapshot();
  previous.request = { ...message(1), sender: { type: "agent", agentId: "channel" } };
  previous.messages[0] = previous.request;
  previous.channel.requestSequence = 1;
  const local = {
    type: "message" as const,
    message: {
      id: "local",
      sender: { type: "user" as const },
      content: "Still sending",
      timestamp: "2026-10-03T20:01:00.000Z",
    },
  };
  const first = reduceChannelState(previous, local);
  const second = { ...local, message: { ...local.message, id: "second" } };
  const pending = reduceChannelState(first, second);
  expect(pending.messages.map(({ id }) => id)).toEqual([
    "message-1",
    "message-101",
    "local",
    "second",
  ]);
  expect(pending.revision).toBe(previous.revision);
  expect(pending.channel).toBe(previous.channel);
  expect(pending.request).toBe(previous.request);
  expect(previous.messages).toHaveLength(2);
  expect(reduceChannelState(pending, local)).toBe(pending);

  const concurrent = { ...message(102), sender: { type: "agent" as const, agentId: "channel" } };
  const interleaved = reduceChannelState(pending, {
    type: "message",
    revision: 102,
    message: concurrent,
  });
  const committedSecond = { ...message(103), id: second.message.id };
  const acknowledged = reduceChannelState(interleaved, {
    type: "message",
    revision: 103,
    message: committedSecond,
  });
  const echo = {
    type: "message" as const,
    revision: 104,
    message: { ...message(104), id: local.message.id },
  };
  const next = reduceChannelState(acknowledged, echo);
  expect(next.messages).toEqual([...previous.messages, concurrent, committedSecond, echo.message]);
  expect(next.messages[0]).toBe(previous.messages[0]);
  expect(next.revision).toBe(104);
  expect(next.channel).toMatchObject({
    latestSequence: 104,
    requestSequence: null,
    updatedAt: echo.message.timestamp,
  });
  expect(next.request).toBeNull();
  expect(reduceChannelState(next, local)).toBe(next);
  expect(reduceChannelState(next, echo)).toBe(next);
});

test("member edits replace and reorder profiles without duplicating membership or transcript", () => {
  const reviewer = { channelId: "channel", id: "reviewer", name: "Reviewer", role: "Old role" };
  const builder = { channelId: "channel", id: "builder", name: "Builder" };
  const joined = [
    system(102, { type: "member_joined", member: reviewer }),
    system(103, { type: "member_joined", member: builder }),
  ].reduce(reduceChannelState, snapshot());
  expect(joined.members).toEqual([builder, reviewer]);
  const updated = { channelId: "channel", id: "reviewer", name: "Architect" };
  const edited = reduceChannelState(joined, { type: "member", revision: 104, member: updated });
  expect(edited.members).toEqual([updated, builder]);
  expect(edited.messages).toBe(joined.messages);
  expect(joined.members).toEqual([builder, reviewer]);
});

test.each(["channel", "reviewer"])(
  "status updates %s without changing membership or history",
  (agentId) => {
    const previous = snapshot();
    previous.members = [{ channelId: "channel", id: "reviewer", name: "Reviewer" }];
    const status = { state: "working" as const, text: "Reviewing", lookingAt: 1 };
    const next = reduceChannelState(previous, {
      type: "status",
      revision: 102,
      agentId,
      status,
    });
    expect([next.lead, ...next.members].find(({ id }) => id === agentId)?.status).toEqual(status);
    expect(next.members.map(({ id }) => id)).toEqual(["reviewer"]);
    expect(next.messages).toBe(previous.messages);
    expect(next.artifacts).toBe(previous.artifacts);
    const cleared = reduceChannelState(next, { type: "status", revision: 103, agentId });
    expect(
      [cleared.lead, ...cleared.members].find(({ id }) => id === agentId)?.status,
    ).toBeUndefined();
    expect([next.lead, ...next.members].find(({ id }) => id === agentId)?.status).toBe(status);
  },
);

test("sharing an artifact preserves its public URL and original share time when retitled", () => {
  const artifact = {
    file: machineFile("/workspace/plan.md"),
    title: "Plan",
    url: "/api/serve/machine/workspace/plan.md",
  };
  const shared = system(102, { type: "artifact_shared", actor: { type: "user" }, artifact });
  const first = reduceChannelState(snapshot(), shared);
  const retitled = system(103, {
    type: "artifact_shared",
    actor: { type: "user" },
    artifact: { ...artifact, title: "Release plan" },
  });
  retitled.message.timestamp = "2026-10-04T21:00:00.000Z";
  const next = reduceChannelState(first, retitled);
  const id = "machine:/workspace/plan.md";
  expect(first.artifacts).toEqual([{ ...artifact, id, sharedAt: shared.message.timestamp }]);
  expect(next.artifacts).toEqual([
    { ...artifact, id, title: "Release plan", sharedAt: shared.message.timestamp },
  ]);
});

test("routine messages add, change in place, and delete routines", () => {
  const standup = { id: "standup", title: "CI", schedule: "0 9 * * 1-5", prompt: "Check CI" };
  const review = { ...standup, id: "review", title: "Review", prompt: "Review the week" };
  const added = [
    system(102, { type: "routine_scheduled", routine: standup }),
    system(103, { type: "routine_scheduled", routine: review }),
  ].reduce(reduceChannelState, snapshot());
  const edited = { ...standup, prompt: "Check CI and new issues" };
  const changed = reduceChannelState(
    added,
    system(104, { type: "routine_edited", routine: edited }),
  );
  const removed = reduceChannelState(
    changed,
    system(105, { type: "routine_deleted", routine: review }),
  );
  expect(added.routines).toEqual([standup, review]);
  expect(changed.routines).toEqual([edited, review]);
  expect(removed.routines).toEqual([edited]);
});

test("history merges by identity and sequence without replacing current values", () => {
  const current = message(2);
  const earlier = message(1);
  const stale = { ...current, content: "Stale" };
  const page = [earlier, stale];
  const merged = mergeChannelMessages([current], page);
  expect(merged).toEqual([earlier, current]);
  expect(mergeChannelMessages(merged, page)).toBe(merged);
});
