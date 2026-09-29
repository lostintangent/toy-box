import type { CreateChannelInput } from "@channels/model";
import type { Worker } from "@workers/model";
import type { ChannelDatabase } from "./database";

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
