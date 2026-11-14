import { expect, onTestFinished, spyOn, test } from "bun:test";
import type { AnyRoute } from "@tanstack/react-router";
import { ChannelDatabase } from "@channels/server/database";
import { releaseChannelEvents } from "@channels/server/eventLog";
import { getChannelCatalog, getChannelSnapshot } from "@channels/server/stream";
import { channelAgent, createStoredChannel, openChannel } from "@channels/server/testFixtures";
import { machineFile, workspaceFileId } from "@files/model";
import * as providers from "@providers/server";
import * as sessionRuntime from "@sessions/server/runtime";
import { deleteSessionActivity } from "@sessions/server/state/activity";
import { detachManagedSession } from "@/server/managedSessions";
import { invokeRoute } from "@/server/testFixtures";
import { Route as CatalogRoute } from "./channels.index";
import { Route as ChannelRoute } from "./channels/$channelId";
import { Route as ArtifactRoute } from "./channels/$channelId.artifacts.$artifactId";
import { Route as BookmarkRoute } from "./channels/$channelId.bookmarks.$sequence";
import { Route as LeadMessagesRoute } from "./channels/$channelId.lead-messages";
import { Route as MemberModelsRoute } from "./channels/$channelId.members.$agentId.models";
import { Route as MemberRoute } from "./channels/$channelId.members.$agentId";
import { Route as MessagesRoute } from "./channels/$channelId.messages";
import { Route as ReadRoute } from "./channels/$channelId.read";
import { Route as RoutineRunRoute } from "./channels/$channelId.routines.$routineId.run";
import { Route as RoutineRoute } from "./channels/$channelId.routines.$routineId";

type Params = Record<string, string>;
type Call = [route: AnyRoute, params: Params, init?: RequestInit, query?: string];

function call(route: AnyRoute, params: Params, init?: RequestInit, query = "") {
  return invokeRoute(
    route,
    new Request(`http://toy-box.test/api/v1/channels${query}`, init),
    params,
  );
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function events(response: Response) {
  const reader = response.body!.getReader();
  onTestFinished(() => reader.cancel());
  const decoder = new TextDecoder();
  return {
    reader,
    async next(): Promise<unknown> {
      while (true) {
        const { value, done } = await reader.read();
        if (done) throw new Error("The stream closed before its next event.");
        const data = decoder
          .decode(value)
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (data) return JSON.parse(data.slice(6));
      }
    },
  };
}

test("the catalog answers JSON, or a stream that opens with the same JSON when asked", async () => {
  await openChannel();
  const response = await call(CatalogRoute, {});
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Vary")).toBe("Accept");
  const catalog = await response.json();
  expect(catalog).toEqual(await getChannelCatalog());

  const stream = await call(CatalogRoute, {}, { headers: { Accept: "text/event-stream" } });
  expect(stream.headers.get("Content-Type")).toStartWith("text/event-stream");
  expect(stream.headers.get("Vary")).toBe("Accept");
  expect(await events(stream).next()).toEqual({ type: "snapshot", catalog });
});

test("a Channel stream snapshots, resumes from a cursor, ignores a blank one, and ends on abort", async () => {
  const { channel } = await openChannel();
  const state = (await getChannelSnapshot(channel.id))!;
  const params = { channelId: channel.id };
  const abort = new AbortController();
  const response = await call(ChannelRoute, params, { signal: abort.signal });
  expect(response.headers.get("Content-Type")).toStartWith("text/event-stream");
  const stream = events(response);
  expect(await stream.next()).toEqual({ type: "snapshot", state });
  abort.abort();
  expect((await stream.reader.read()).done).toBe(true);

  for (const [query, type] of [
    [`?after=${state.revision}`, "resumed"],
    ["?after=", "snapshot"],
    ["?after=%20%20", "snapshot"],
  ]) {
    expect(await events(await call(ChannelRoute, params, undefined, query)).next()).toMatchObject({
      type,
    });
  }
});

test("posting answers the stored message, and history pages it without caching", async () => {
  const { channel } = await openChannel();
  const params = { channelId: channel.id };
  const message = { id: "public", content: "Please continue @http-no-recipient" };
  const posted = await call(MessagesRoute, params, json("POST", message));
  expect(posted.status).toBe(201);
  expect(await posted.json()).toMatchObject({ ...message, sequence: 1, sender: { type: "user" } });

  const history = await call(MessagesRoute, params, undefined, "?before=2");
  expect(history.headers.get("Cache-Control")).toBe("no-store");
  expect(await history.json()).toMatchObject({ revision: 1, messages: [{ id: message.id }] });
});

test("reading answers the user's cursor, and bookmarks map their verbs to idempotent 204s", async () => {
  const { channel, channels } = await openChannel();
  const params = { channelId: channel.id };
  await channels.appendMessage({ ...params, id: "note", sender: { type: "user" }, content: "Hi" });
  const read = await call(ReadRoute, params, json("POST", { sequence: 1 }));
  expect(await read.json()).toEqual({ seenThrough: 1 });

  const bookmark = { ...params, sequence: "1" };
  for (const [method, bookmarks] of [
    ["PUT", [1]],
    ["PUT", [1]],
    ["DELETE", []],
  ] as const) {
    expect((await call(BookmarkRoute, bookmark, { method })).status).toBe(204);
    expect((await getChannelSnapshot(channel.id))?.bookmarks).toEqual([...bookmarks]);
  }
});

test("requests that can't name a valid command answer 400 before reaching the Channel", async () => {
  const { channel, channels } = await openChannel();
  const params = { channelId: channel.id };
  const { member } = await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
  onTestFinished(() => deleteSessionActivity(member.id));
  const malformed = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" };
  const rows: Call[] = [
    ...[null, [], {}, { id: "m", content: "Hi", channelId: "other" }].map((body): Call => [
      MessagesRoute,
      params,
      json("POST", body),
    ]),
    [MessagesRoute, params, malformed],
    [MessagesRoute, params, { method: "POST", body: "hello" }],
    [MemberRoute, { ...params, agentId: member.id }, json("PATCH", { role: "R", agentId: "x" })],
    [CatalogRoute, {}, json("POST", { name: "No model" })],
    ...["", "0", "-1", "1.5", "bad"].map((before): Call => [
      MessagesRoute,
      params,
      {},
      `?before=${before}`,
    ]),
    ...["0", "-1", "1.5", "bad"].map((sequence): Call => [
      BookmarkRoute,
      { ...params, sequence },
      { method: "PUT" },
    ]),
  ];
  for (const [route, params, init, query] of rows) {
    const response = await call(route, params, init, query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request." });
  }
});

test("missing Channels and resources, the lead, and other Channels' members answer 404", async () => {
  const { channel, channels } = await openChannel();
  const other = await createStoredChannel(channels, {
    name: "Elsewhere",
    model: { provider: "copilot", name: "gpt-5.5" },
  });
  const { member } = await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
  onTestFinished(() => {
    releaseChannelEvents(other.id);
    deleteSessionActivity(member.id);
  });
  const missing = { channelId: "missing" };
  const lead = { channelId: channel.id, agentId: channel.id };
  const elsewhere = { channelId: other.id, agentId: member.id };
  const rows: Call[] = [
    [MessagesRoute, missing, {}, "?before=2"],
    [MessagesRoute, missing, json("POST", { id: "m", content: "Hi" })],
    [ReadRoute, missing, json("POST", { sequence: 0 })],
    [BookmarkRoute, { ...missing, sequence: "1" }, { method: "PUT" }],
    [ChannelRoute, missing, json("PATCH", { name: "Gone" })],
    [ChannelRoute, missing, { method: "DELETE" }],
    [RoutineRunRoute, { channelId: channel.id, routineId: "missing" }, { method: "POST" }],
    [
      LeadMessagesRoute,
      missing,
      json("POST", { from: "apple", channelName: "Apple", server: "Studio", content: "Hi" }),
    ],
    // The intrinsic lead is never a member, so it cannot be edited, removed, or modeled as one.
    [MemberRoute, lead, json("PATCH", { role: "X" })],
    [MemberRoute, lead, { method: "DELETE" }],
    [MemberModelsRoute, lead, {}],
    [MemberRoute, elsewhere, json("PATCH", { role: "X" })],
    [MemberRoute, elsewhere, { method: "DELETE" }],
    [MemberModelsRoute, elsewhere, {}],
  ];
  for (const [route, params, init, query] of rows)
    expect((await call(route, params, init, query)).status).toBe(404);
});

test("removals answer 204 once and 404 after, and the user removes members", async () => {
  const { channel, channels } = await openChannel();
  const { routine } = await channels.setRoutine(channel.id, {
    title: "Morning check",
    schedule: "0 9 * * 1-5",
    prompt: "Review overnight progress.",
  });
  const file = machineFile("/workspace/plan.md");
  await channels.shareArtifact({
    channelId: channel.id,
    file,
    title: "Plan",
    actor: { type: "user" },
  });
  const { member } = await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
  const cleanup = spyOn(sessionRuntime, "deleteSessionIfExists").mockImplementation(async (id) => {
    await detachManagedSession(id);
    return true;
  });
  onTestFinished(() => {
    cleanup.mockRestore();
    deleteSessionActivity(member.id);
  });
  const removals: Array<[AnyRoute, Params]> = [
    [RoutineRoute, { channelId: channel.id, routineId: routine.id }],
    [ArtifactRoute, { channelId: channel.id, artifactId: workspaceFileId(file) }],
    [MemberRoute, { channelId: channel.id, agentId: member.id }],
  ];
  for (const status of [204, 404])
    for (const [route, params] of removals)
      expect((await call(route, params, { method: "DELETE" })).status).toBe(status);
  expect((await channels.listMessagesAfter(channel.id)).at(-1)?.content).toMatchObject({
    type: "member_left",
    actor: { type: "user" },
  });
});

test("edits answer the updated Channel or member", async () => {
  const { channel, channels } = await openChannel();
  const { member } = await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
  onTestFinished(() => deleteSessionActivity(member.id));
  const edit = await call(ChannelRoute, { channelId: channel.id }, json("PATCH", { name: "Shop" }));
  expect(edit.status).toBe(200);
  expect(await edit.json()).toMatchObject({ id: channel.id, name: "Shop" });

  const params = { channelId: channel.id, agentId: member.id };
  const update = await call(MemberRoute, params, json("PATCH", { role: "Build" }));
  expect(update.status).toBe(200);
  expect(await update.json()).toMatchObject({ id: member.id, name: "Builder", role: "Build" });
});

test("member models answer the member's provider with its choices, uncached", async () => {
  const { channel, channels } = await openChannel();
  const catalog = spyOn(providers, "listModels").mockResolvedValue([
    { id: "gpt-5.5", name: "GPT-5.5", provider: "copilot" },
    { id: "sonnet", name: "Sonnet", provider: "claude" },
  ]);
  const { member } = await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
  onTestFinished(() => {
    catalog.mockRestore();
    deleteSessionActivity(member.id);
  });
  await channels.updateMember(member.id, { model: { provider: "claude", name: "sonnet" } });
  const response = await call(MemberModelsRoute, { channelId: channel.id, agentId: member.id });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    provider: "claude",
    models: [expect.objectContaining({ id: "sonnet" })],
    defaultModel: null,
  });
});

test("domain refusals keep their meaning on the wire", async () => {
  const { channel, channels } = await openChannel();
  const other = await createStoredChannel(channels, {
    name: "Other",
    model: { provider: "copilot", name: "gpt-5.5" },
  });
  onTestFinished(() => releaseChannelEvents(other.id));
  await channels.updateChannel(channel.id, { name: "Renamed" });
  const system = { channelId: channel.id, sequence: "1" };
  const refused = await call(BookmarkRoute, system, { method: "PUT" });
  expect(refused.status).toBe(422);
  expect(await refused.json()).toEqual({
    error: "Bookmark a user or agent message in this Channel.",
  });

  const message = json("POST", { id: "taken", content: "Hi @http-no-recipient" });
  expect((await call(MessagesRoute, { channelId: channel.id }, message)).status).toBe(201);
  const conflict = await call(MessagesRoute, { channelId: other.id }, message);
  expect(conflict.status).toBe(422);
  expect(await conflict.json()).toEqual({ error: "Message ID already exists." });
});

test("a peer lead's message wakes the lead, naming the sender's channel and server", async () => {
  const { channel } = await openChannel();
  const deliver = spyOn(sessionRuntime, "deliverSessionMessage").mockResolvedValue({
    disposition: "started",
    waitForCompletion: async () => ({ status: "completed" }),
  });
  onTestFinished(() => deliver.mockRestore());
  const message = json("POST", {
    from: "apple",
    channelName: "Apple",
    server: "Studio",
    content: "Which branch?",
  });

  expect((await call(LeadMessagesRoute, { channelId: channel.id }, message)).status).toBe(204);
  expect(deliver.mock.calls).toEqual([
    [
      channel.id,
      {
        systemMessage: {
          type: "channel_lead_message",
          channelId: "apple",
          channelName: "Apple",
          server: "Studio",
          content: "Which branch?",
        },
        immediate: true,
      },
    ],
  ]);
});

test.each([new Error("Private database details"), "Private non-Error failure"])(
  "unexpected failures are logged and answer a generic 500 (%s)",
  async (error) => {
    const { channel } = await openChannel();
    const failure = spyOn(ChannelDatabase.prototype, "editChannel").mockRejectedValue(error);
    const logging = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => {
      failure.mockRestore();
      logging.mockRestore();
    });
    const response = await call(
      ChannelRoute,
      { channelId: channel.id },
      json("PATCH", { name: "Shop" }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: `Unable to edit Channel ${channel.id}.` });
    expect(logging).toHaveBeenCalledWith(`Failed to edit Channel ${channel.id}:`, error);
  },
);
