import { onTestFinished } from "bun:test";
import type { CreateChannelInput } from "@channels/model";
import { deleteSessionActivity } from "@sessions/server/state/activity";
import type { Worker } from "@workers/model";
import { openTestDatabase } from "@/server/testFixtures";
import { ChannelDatabase } from "./database";
import { releaseChannelEvents } from "./events";

export function channelAgent(
  channelId: string,
  sessionId: string,
  name?: string,
): Extract<Worker, { type: "channel" }> {
  return {
    createdAt: new Date(0).toISOString(),
    type: "channel",
    channelId,
    sessionId,
    ephemeral: false,
    name,
    metadata: { seenThrough: 0 },
  };
}

/** Persist a Channel fixture without starting its provider. */
export function createStoredChannel(database: ChannelDatabase, input: CreateChannelInput) {
  const channelId = crypto.randomUUID();
  return database.createChannel(input, channelAgent(channelId, channelId));
}

/** One stored Channel in a fresh state database that the code under test reads. */
export async function openChannel() {
  const channels = new ChannelDatabase(await openTestDatabase());
  const channel = await createStoredChannel(channels, {
    name: "Studio",
    model: { provider: "copilot", name: "gpt-5.5" },
  });
  onTestFinished(() => {
    releaseChannelEvents(channel.id);
    deleteSessionActivity(channel.id);
  });
  return { channel, channels };
}
