import { expect, onTestFinished, spyOn, test } from "bun:test";
import type { AnyRoute } from "@tanstack/react-router";
import { ChannelDatabase } from "@channels/server/database";
import { releaseChannelEvents } from "@channels/server/eventLog";
import { getChannelCatalog, getChannelSnapshot } from "@channels/server/stream";
import {
  channelAgent,
  createStoredChannel,
  linkServers,
  openChannel,
  serveLinkedServer,
  toyBoxServer,
} from "@channels/server/testFixtures";
import { machineFile, workspaceFileId } from "@files/model";
import * as providers from "@providers/server";
import * as sessionRuntime from "@sessions/server/runtime";
import { deleteSessionActivity } from "@sessions/server/state/activity";
import { detachManagedSession } from "@/server/managedSessions";
import { invokeRoute, openTestDatabase } from "@/server/testFixtures";
import { getServer } from "@workspace/server/installation";
import startWorkspace from "@workspace/server/startup";
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
import { Route as ServerLinksRoute } from "./server.links";

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
    [LeadMessagesRoute, missing, json("POST", { from: "apple", content: "Hi" })],
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

test("a linked lead's message wakes the lead only when this server finds the sender", async () => {
  const { channel } = await openChannel();
  const studio = serveLinkedServer(toyBoxServer("Studio", [{ id: "apple", name: "Apple" }]));
  await linkServers(studio.href);
  const deliver = spyOn(sessionRuntime, "deliverSessionMessage").mockResolvedValue({
    disposition: "started",
    waitForCompletion: async () => ({ status: "completed" }),
  });
  onTestFinished(() => deliver.mockRestore());
  const message = (from: string) => json("POST", { from, content: "Which branch?" });

  expect((await call(LeadMessagesRoute, { channelId: channel.id }, message("apple"))).status).toBe(
    204,
  );
  const unknownSender = await call(LeadMessagesRoute, { channelId: channel.id }, message("pear"));
  expect(unknownSender.status).toBe(422);
  expect(await unknownSender.json()).toEqual({
    error: "This server can't find the sending channel on its linked servers.",
  });
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

// Route requests reach this server as http://toy-box.test, which a linked server can link back to.
function serverLinks(init?: RequestInit, query = "", origin = "http://toy-box.test") {
  return invokeRoute(ServerLinksRoute, new Request(`${origin}/api/v1/server/links${query}`, init));
}
const link = (address: string, origin?: string) =>
  serverLinks(json("POST", { address }), "", origin);
const unlink = (address: string, origin?: string) =>
  serverLinks({ method: "DELETE" }, `?address=${encodeURIComponent(address)}`, origin);
const links = async (answer: Response | Promise<Response>) => (await (await answer).json()).links;

/** A linked server that links and unlinks this one back through this server's route, as a real
 *  one would, and records what it was asked. */
function serveLinkingServer(name: string) {
  const asked: string[] = [];
  const server = serveLinkedServer(
    toyBoxServer(name, [], async (request) => {
      const url = new URL(request.url);
      if (url.pathname !== "/api/v1/server/links") return new Response(null, { status: 404 });
      if (request.method === "POST") {
        const { address } = await request.json();
        asked.push(`link ${address}`);
        return link(url.origin, address);
      }
      const address = url.searchParams.get("address")!;
      asked.push(`unlink ${address}`);
      return unlink(url.origin, address);
    }),
  );
  return Object.assign(server, { asked });
}

test("linking and unlinking change both ends once however an address is typed, and answer the server", async () => {
  await openTestDatabase();
  const studio = serveLinkingServer("Studio");
  const laptop = serveLinkingServer("Laptop");
  // Linked last, the laptop sorts first, so only link order puts it second.
  const laptopLink = `http://127.0.0.1:${laptop.port}`;

  const linked = await link(` ${studio.href} `);
  expect(await linked.json()).toEqual({ ...(await getServer()), links: [studio.origin] });
  expect(await links(link(`${laptopLink}//?tab=1#top`))).toEqual([studio.origin, laptopLink]);
  expect(await links(link(studio.origin))).toEqual([studio.origin, laptopLink]);
  expect(await links(unlink(studio.href))).toEqual([laptopLink]);
  expect(await links(unlink(studio.href))).toEqual([laptopLink]);
  expect(studio.asked).toEqual(["link http://toy-box.test", "unlink http://toy-box.test"]);
  expect(laptop.asked).toEqual(["link http://toy-box.test"]);

  // A server that's already linked answers without being reached, even while it sleeps.
  await linkServers(laptopLink, "http://127.0.0.1:1");
  expect(await links(link("http://127.0.0.1:1/"))).toEqual([laptopLink, "http://127.0.0.1:1"]);
  // One that doesn't answer an unlink stays linked to this one until it's unlinked there.
  expect(await links(unlink("http://127.0.0.1:1"))).toEqual([laptopLink]);
});

test("a request that reaches this server on loopback links and unlinks only this end", async () => {
  await openTestDatabase();
  const studio = serveLinkingServer("Studio");

  for (const origin of ["http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"]) {
    expect(await links(link(studio.href, origin))).toEqual([studio.origin]);
    expect(await links(unlink(studio.href, origin))).toEqual([]);
  }
  expect(studio.asked).toEqual([]);
});

test("a server that links this one back over a proxy is asked at the proxy's address", async () => {
  await openTestDatabase();
  const studio = serveLinkingServer("Studio");

  const proxied = new Request("http://mac-mini.ts.net/api/v1/server/links", {
    ...json("POST", { address: studio.href }),
    headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https, http" },
  });
  expect((await invokeRoute(ServerLinksRoute, proxied)).status).toBe(200);
  expect(studio.asked).toEqual(["link https://mac-mini.ts.net"]);
});

test("an address that isn't another reachable, current Toy Box server that links back is refused with why, and nothing changes", async () => {
  await openTestDatabase();
  await startWorkspace();
  const page = serveLinkedServer(() => new Response("<html></html>"));
  const older = serveLinkedServer(() => new Response("Not found", { status: 404 }));
  const itself = serveLinkedServer(async () => Response.json(await getServer()));
  let refusals = 0;
  const refusing = serveLinkedServer(
    toyBoxServer("Studio", [], () => {
      refusals += 1;
      return Response.json(
        { error: "This server can't reach http://toy-box.test." },
        { status: 422 },
      );
    }),
  );

  for (const [address, error] of [
    ["ftp://studio", "Enter a host like mac-mini.tail1234.ts.net, or an http:// address."],
    [page.href, `This server can't reach ${page.origin} (Not a Toy Box server).`],
    // A bare host means https, which this plain-HTTP page can't speak.
    [page.host, expect.stringContaining(`can't reach https://${page.host} (EPROTO`)],
    [older.href, `Update Toy Box on ${older.origin}, then link it again.`],
    [itself.href, "That's this server."],
    [
      refusing.href,
      `${refusing.origin} didn't link back: This server can't reach http://toy-box.test.`,
    ],
    // A refused link isn't left linking, so trying again asks again.
    [
      refusing.href,
      `${refusing.origin} didn't link back: This server can't reach http://toy-box.test.`,
    ],
  ] as const) {
    const refused = await link(address);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error });
  }
  expect(refusals).toBe(2);
  expect((await unlink("ftp://studio")).status).toBe(422);
  expect((await serverLinks({ method: "DELETE" })).status).toBe(400);
  expect((await getServer()).links).toEqual([]);
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
