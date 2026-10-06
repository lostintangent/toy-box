import { expect, onTestFinished, spyOn, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { channelLead, type ChannelConversationMessage, type ChannelList } from "./model";
import type { ChannelObservationEvent, ChannelState } from "./model";
import { channelQueries, type ChannelQueryData } from "./queries";
import { channelMutations } from "./mutations";
import { mergeChannelMessages } from "./model/reducer";

const message = (sequence: number): ChannelConversationMessage => ({
  id: `message-${sequence}`,
  sequence,
  timestamp: "2026-10-03T20:00:00.000Z",
  sender: { type: "user" },
  content: `Message ${sequence}`,
});
const snapshot: ChannelState = {
  channel: {
    id: "channel",
    name: "Planning",
    model: { provider: "codex", name: "gpt-5.5" },
    tasks: [],
    latestSequence: 101,
    seenThrough: 0,
    completedSequence: null,
    requestSequence: null,
    updatedAt: "2026-10-03T20:00:00.000Z",
  },
  revision: 101,
  lead: channelLead("channel"),
  members: [],
  messages: [message(101)],
  artifacts: [],
  routines: [],
  request: null,
  presence: {},
};

test.each([undefined, 0])(
  "arrival uses the authoritative snapshot, with cursor %s",
  async (revision) => {
    const stream = openStream(
      revision === undefined
        ? undefined
        : {
            ...snapshot,
            channel: { ...snapshot.channel, latestSequence: 0 },
            revision,
            messages: [],
            arrival: { id: 1, unreadAfter: null },
          },
    );
    const acknowledged = { ...snapshot.channel, latestSequence: 102, seenThrough: 102 };
    stream.client.setQueryData(channelQueries.listKey(), { channels: [acknowledged], members: [] });
    const connection = await stream.nextConnection();
    expect(connection.url).toBe(
      `/api/v1/channels/channel${revision === undefined ? "" : "?after=0"}`,
    );
    connection.send({ type: "snapshot", state: snapshot });
    await stream.waitFor((view) => view?.revision === 101);
    expect(stream.view()!.arrival.unreadAfter).toBe(0);
    expect(stream.client.getQueryData<ChannelList>(channelQueries.listKey())?.channels).toEqual([
      acknowledged,
    ]);
  },
);

test("replayed reads establish arrival only at the resumption and retain paging and optimism", async () => {
  const arrival = { id: 1, unreadAfter: 0 };
  const stream = openStream({ ...snapshot, arrival });
  const connection = await stream.nextConnection();
  connection.send({ type: "message", revision: 102, message: message(102) });
  await stream.waitFor((view) => view?.revision === 102);
  stream.client.setQueryData<ChannelQueryData>(stream.key, (view) => ({
    ...view!,
    messages: mergeChannelMessages(view!.messages, [message(1)]),
  }));
  await channelMutations.post().onMutate!(
    { channelId: snapshot.channel.id, id: "optimistic", content: "Still sending" },
    { client: stream.client, meta: undefined },
  );
  connection.send({ type: "read", revision: 103, seenThrough: 102 });
  await stream.waitFor((view) => view?.revision === 103);
  expect(stream.view()!.arrival).toEqual(arrival);
  connection.send({ type: "resumed", presence: {} });
  await stream.waitFor((view) => view?.arrival.id !== arrival.id);
  expect(stream.view()!.arrival.unreadAfter).toBeNull();
  expect(stream.view()!.messages.map(({ id }) => id)).toEqual([
    "message-1",
    "message-101",
    "message-102",
    "optimistic",
  ]);
  const arrived = stream.view()!.arrival;
  connection.send({ type: "presence", presence: { channel: { state: "working" } } });
  await stream.waitFor((view) => view?.presence.channel?.state === "working");
  expect(stream.view()!.arrival).toEqual(arrived);
});

test("deletion before bootstrap completes observation and removes the catalog entry", async () => {
  const stream = openStream();
  stream.client.setQueryData(channelQueries.listKey(), {
    channels: [snapshot.channel],
    members: [{ channelId: snapshot.channel.id, id: "reviewer", name: "Reviewer" }],
  });
  const connection = await stream.nextConnection();
  connection.send({ type: "deleted", channelId: snapshot.channel.id });
  await stream.finished;
  expect(stream.view()).toBeNull();
  expect(stream.client.getQueryData<ChannelList>(channelQueries.listKey())).toEqual({
    channels: [],
    members: [],
  });
});

test("unexpected EOF reconnects from the last applied revision", async () => {
  const stream = openStream();
  const first = await stream.nextConnection();
  first.send({ type: "snapshot", state: snapshot });
  first.send({ type: "message", revision: 102, message: message(102) });
  await stream.waitFor((view) => view?.revision === 102);
  first.end();
  const retried = await stream.nextConnection();
  expect(retried.url).toBe("/api/v1/channels/channel?after=102");
});

type Connection = {
  url: string;
  send(event: ChannelObservationEvent): void;
  end(): void;
};

function openStream(cached?: ChannelQueryData) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const options = { ...channelQueries.detail(snapshot.channel.id), retryDelay: 0 };
  const key = options.queryKey;
  if (cached) client.setQueryData(key, cached);
  let connected = Promise.withResolvers<Connection>();
  const respond = Object.assign(
    async (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      const signal = init!.signal!;
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      });
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      const connection = {
        url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        send(event: ChannelObservationEvent) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        },
        end() {
          controller.close();
        },
      };
      connected.resolve(connection);
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    },
    globalThis.fetch,
  );
  const fetch = spyOn(globalThis, "fetch").mockImplementation(respond);
  const finished = client.query(options);
  void finished.catch(() => {}); // Other cases deliberately cancel their open stream during cleanup.
  onTestFinished(() => {
    client.clear();
    fetch.mockRestore();
  });
  const view = () => client.getQueryData<ChannelQueryData | null>(key);
  return {
    client,
    key,
    finished,
    view,
    nextConnection: async () => {
      const connection = await connected.promise;
      connected = Promise.withResolvers<Connection>();
      return connection;
    },
    waitFor: (ready: (view: ChannelQueryData | null | undefined) => boolean): Promise<void> => {
      if (ready(view())) return Promise.resolve();
      return new Promise((resolve) => {
        const stop = client.getQueryCache().subscribe(() => {
          if (!ready(view())) return;
          stop();
          resolve();
        });
      });
    },
  };
}
